import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationKind,
  ConversationStatus,
  MessageSender,
  MessageState,
  type Message,
} from '@prisma/client';
import { pacificDayStart } from '@common/ai/pacific-day.util';
import { AiRunError, AiService, type AiChatOutcome } from '@common/ai/ai.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiAccessService } from '@modules/ai-coaching/shared/ai-access.service';
import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { enqueueSummary } from '@modules/conversations/jobs/conversation-summary.queue';
import {
  AI_CHAT_FOOTER,
  OFF_TOPIC_REDIRECT,
  RETRACTED_REPLY,
  smallTalkReply,
  withFooter,
} from '@modules/conversations/shared/ai-chat.constants';
import { AiChatContextBuilder } from '@modules/conversations/shared/ai-chat-context.builder';
import { buildChatRequest } from '@modules/conversations/shared/ai-chat.request';
import { appendMessage, lockConversation } from '@modules/conversations/shared/append-message';
import { ChatReplyProcessor } from '@modules/conversations/shared/chat-reply.processor';
import { loadOwnAiConversation } from '@modules/conversations/shared/load-own-ai-conversation';
import type { NameGroup } from '@modules/conversations/shared/pii-redaction';
import { isSmallTalk } from '@modules/conversations/shared/small-talk';
import { SendAiMessageDto } from './dto/send-ai-message.dto';

/** Where the reply goes. The controller turns these into server-sent events. */
export interface ChatSink {
  /** Called once, before the provider is called: the controller sends the headers and a first heartbeat. */
  start(): void;
  event(name: 'delta' | 'retract' | 'done' | 'error', data: Record<string, unknown>): void;
}

interface ParentTurn {
  parent: Message;
  /** The reply stored by an earlier attempt of the same message, if there is one. */
  reply: Message | null;
  closed: boolean;
}

interface ReplyToStore {
  state: MessageState;
  body: string;
  /** False for a redirect of plain small talk: the parent did not leave the topic. */
  strike: boolean;
}

/**
 * One parent message to the AI assistant and its streamed reply (plan 0019 section 6.5).
 *
 * Everything that can be refused is refused before the stream starts, as an ordinary problem
 * response. The response headers go out when the first piece of text arrives from the provider; from
 * then on this service never throws: a failure becomes an `error` event, so nothing can reach the
 * global exception filter after the headers are sent. Only error classes and codes are ever logged.
 */
@Injectable()
export class SendAiMessageService {
  private readonly logger = new Logger(SendAiMessageService.name);
  /** Chats with a reply being written. One instance serves this app (plan 0019 section 3 row 8). */
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
    private readonly contexts: AiChatContextBuilder,
    private readonly ai: AiService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly queue: JobQueueService,
  ) {}

  async stream(
    id: string,
    dto: SendAiMessageDto,
    caller: AuthenticatedUser,
    signal: AbortSignal,
    sink: ChatSink,
  ): Promise<void> {
    const chat = this.config.get('aiChat', { infer: true });
    const conversation = await loadOwnAiConversation(this.prisma, id, caller);
    if (!conversation.topic) {
      throw new UnprocessableEntityException({
        code: 'NOT_AN_AI_CONVERSATION',
        message: 'This chat has no topic.',
      });
    }
    const child = await this.access.assertCanChat(conversation.childId, caller);
    if (dto.text.length > chat.maxMessageChars) {
      throw new UnprocessableEntityException({
        code: 'MESSAGE_TOO_LONG',
        message: `Messages can have at most ${chat.maxMessageChars} characters.`,
      });
    }

    if (this.active.has(id)) {
      throw new ConflictException({
        code: 'AI_CHAT_BUSY',
        message: 'A reply is already being written for this chat.',
      });
    }
    this.active.add(id);
    try {
      const turn = await this.persistParentMessage(id, dto, caller, chat);
      if (turn.reply) {
        this.replay(turn, sink);
        return;
      }

      const names = await this.nameGroups(child.id, child.name, caller.id);
      const built = await this.contexts.build(conversation.topic, child, caller);
      const history = await this.prisma.message.findMany({
        where: { conversationId: id, state: MessageState.COMPLETE, seq: { lte: turn.parent.seq } },
        orderBy: { seq: 'desc' },
        take: chat.historyMessages + 1,
        select: { sender: true, body: true },
      });
      const request = buildChatRequest({
        topic: conversation.topic,
        context: built.context,
        history: history.reverse(),
        names,
        maxMessageChars: chat.maxMessageChars,
        actor: { userId: caller.id, childId: child.id },
        signal,
        maxOutputTokens: chat.maxOutputTokens,
      });
      await this.respond(
        id,
        request,
        names.flatMap((n) => n.tokens),
        signal,
        sink,
        isSmallTalk(dto.text) ? smallTalkReply(conversation.topic) : null,
      );
    } finally {
      this.active.delete(id);
    }
  }

  /** Stores the parent's message, or finds the one an earlier attempt stored (idempotent send). */
  private persistParentMessage(
    id: string,
    dto: SendAiMessageDto,
    caller: AuthenticatedUser,
    chat: AppConfig['aiChat'],
  ): Promise<ParentTurn> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockConversation(tx, id);
      const existing = await tx.message.findUnique({
        where: {
          conversationId_clientMessageId: {
            conversationId: id,
            clientMessageId: dto.clientMessageId,
          },
        },
      });
      const closed = locked.status !== ConversationStatus.OPEN;

      if (existing) {
        if (existing.sender !== MessageSender.PARENT || existing.senderId !== caller.id) {
          throw new ConflictException({
            code: 'CLIENT_MESSAGE_ID_IN_USE',
            message: 'That clientMessageId was already used by someone else in this conversation.',
          });
        }
        const reply = await tx.message.findFirst({
          where: { conversationId: id, seq: existing.seq + 1, sender: MessageSender.AI },
        });
        if (reply) return { parent: existing, reply, closed };
        // A retry after a failed attempt: only the newest message can still be answered.
        if (closed) throw this.closedError(locked.offTopicCount, chat);
        if (existing.seq !== locked.lastMessageSeq) {
          throw new ConflictException({
            code: 'AI_CHAT_REPLY_UNAVAILABLE',
            message: 'That message can no longer be retried. Send it again as a new message.',
          });
        }
        return { parent: existing, reply: null, closed };
      }

      if (closed) throw this.closedError(locked.offTopicCount, chat);
      const [turns, today] = await Promise.all([
        tx.message.count({ where: { conversationId: id, sender: MessageSender.PARENT } }),
        tx.message.count({
          where: {
            sender: MessageSender.PARENT,
            senderId: caller.id,
            conversation: { kind: ConversationKind.AI },
            createdAt: { gte: pacificDayStart(new Date()) },
          },
        }),
      ]);
      if (turns >= chat.maxTurns) {
        throw this.limitError('This chat is full. Please start a new one.');
      }
      if (today >= chat.dailyMessages) {
        throw this.limitError(
          'You have reached the daily limit for AI chat. Please try again tomorrow.',
        );
      }

      const parent = await appendMessage(tx, id, locked, {
        sender: MessageSender.PARENT,
        senderId: caller.id,
        clientMessageId: dto.clientMessageId,
        body: dto.text,
      });
      return { parent, reply: null, closed: false };
    });
  }

  private closedError(offTopicCount: number, chat: AppConfig['aiChat']): ConflictException {
    return offTopicCount >= chat.offTopicLimit
      ? new ConflictException({
          code: 'AI_CHAT_OFF_TOPIC_LIMIT',
          message:
            'This chat was closed because it kept leaving the topic. Pick a topic to start again.',
        })
      : new ConflictException({
          code: 'CONVERSATION_CLOSED',
          message: 'This conversation is closed. Start a new one.',
        });
  }

  private limitError(message: string): HttpException {
    return new HttpException(
      { code: 'AI_CHAT_LIMIT_REACHED', message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** The same message sent again after its reply was stored: play the stored reply back. */
  private replay(turn: ParentTurn, sink: ChatSink): void {
    const reply = turn.reply!;
    sink.start();
    sink.event(reply.state === MessageState.RETRACTED ? 'retract' : 'delta', { text: reply.body });
    sink.event('done', this.donePayload(reply, turn.closed));
  }

  private donePayload(message: Message, closed: boolean): Record<string, unknown> {
    return {
      messageId: message.id,
      seq: message.seq,
      state: message.state,
      conversationClosed: closed,
    };
  }

  /** Names to remove from the parent's text and to block in the reply: child, parent, care team. */
  private async nameGroups(
    childId: string,
    childName: string,
    parentId: string,
  ): Promise<NameGroup[]> {
    const [parent, team] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: parentId }, select: { name: true } }),
      this.prisma.child.findUniqueOrThrow({
        where: { id: childId },
        select: {
          clinicianAssignments: { select: { clinician: { select: { name: true } } } },
          expertAssignments: { select: { expert: { select: { name: true } } } },
        },
      }),
    ]);
    return [
      { tokens: nameTokens(childName), placeholder: 'the child' },
      { tokens: nameTokens(parent.name), placeholder: 'the parent' },
      ...team.clinicianAssignments.map(({ clinician }) => ({
        tokens: nameTokens(clinician.name),
        placeholder: 'the clinician',
      })),
      ...team.expertAssignments.map(({ expert }) => ({
        tokens: nameTokens(expert.name),
        placeholder: 'the expert',
      })),
    ];
  }

  private async respond(
    conversationId: string,
    request: ReturnType<typeof buildChatRequest>,
    blockedNames: string[],
    signal: AbortSignal,
    sink: ChatSink,
    smallTalk: string | null,
  ): Promise<void> {
    const run = this.ai.streamChat(request);
    const processor = new ChatReplyProcessor(blockedNames);
    let ended = false;
    let verdict: AiChatOutcome = 'INVALID_OUTPUT';
    const chat = this.config.get('aiChat', { infer: true });
    // Everything that can be refused has been. Open the stream now so the client can show a typing state while
    // the provider thinks (it can take a minute); from here on a failure is an `error` event, never a throw.
    sink.start();
    try {
      for await (const event of run.events) {
        if (event.type === 'end') ended = true;
        const actions =
          event.type === 'delta' ? processor.push(event.text) : processor.end(event.finishReason);
        for (const action of actions) {
          if (action.type === 'delta') sink.event('delta', { text: action.text });
          else sink.event('retract', { text: RETRACTED_REPLY });
        }
        if (processor.outcome === 'RETRACTED') break;
      }
      // The client left: the provider call is already cancelled, and nothing is stored as an answer.
      if (signal.aborted) {
        if (ended) verdict = 'COMPLETE'; // the provider had finished; only the client was gone
        return;
      }

      const outcome = processor.outcome;
      if (outcome === 'EMPTY') throw new AiRunError('AI_INVALID_OUTPUT');
      const reply = this.replyToStore(outcome, processor.text, smallTalk);
      verdict = outcome === 'RETRACTED' ? 'BLOCKED' : 'COMPLETE';

      const { message, closed } = await this.storeReply(conversationId, reply, chat.offTopicLimit);
      if (outcome === 'COMPLETE') sink.event('delta', { text: `\n\n${AI_CHAT_FOOTER}` });
      if (outcome === 'REDIRECTED') sink.event('delta', { text: reply.body });
      sink.event('done', this.donePayload(message, closed));
    } catch (err) {
      this.logFailure(err);
      sink.event('error', { code: this.errorCode(err) });
    } finally {
      await run.finish(verdict);
    }
  }

  private replyToStore(
    outcome: 'COMPLETE' | 'REDIRECTED' | 'RETRACTED',
    text: string,
    smallTalk: string | null,
  ): ReplyToStore {
    switch (outcome) {
      case 'REDIRECTED':
        return smallTalk
          ? { state: MessageState.REDIRECTED, body: smallTalk, strike: false }
          : { state: MessageState.REDIRECTED, body: OFF_TOPIC_REDIRECT, strike: true };
      case 'RETRACTED':
        return { state: MessageState.RETRACTED, body: RETRACTED_REPLY, strike: false };
      case 'COMPLETE':
        return { state: MessageState.COMPLETE, body: withFooter(text), strike: false };
    }
  }

  /** Stores the AI reply. A third off-topic reply also closes the chat and queues its summary. */
  private async storeReply(
    id: string,
    reply: ReplyToStore,
    offTopicLimit: number,
  ): Promise<{ message: Message; closed: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await lockConversation(tx, id);
      if (locked.status !== ConversationStatus.OPEN) {
        throw new ConflictException({
          code: 'CONVERSATION_CLOSED',
          message: 'This conversation is closed. Start a new one.',
        });
      }
      const message = await appendMessage(tx, id, locked, {
        sender: MessageSender.AI,
        body: reply.body,
        state: reply.state,
      });
      let closed = false;
      if (reply.strike) {
        const strikes = locked.offTopicCount + 1;
        closed = strikes >= offTopicLimit;
        await tx.conversation.update({
          where: { id },
          data: {
            offTopicCount: strikes,
            ...(closed ? { status: ConversationStatus.CLOSED, closedAt: new Date() } : {}),
          },
        });
        if (closed) await enqueueSummary(tx, this.queue, { id, childId: locked.childId });
      }
      return { message, closed };
    });
    if (result.closed) await this.queue.kick();
    return result;
  }

  /**
   * The code of an `error` event. Only codes this app chose are passed on: a provider failure, or
   * one of our own refusals met after the stream began (a chat closed while the reply was written
   * is `CONVERSATION_CLOSED`). Anything else is a generic `AI_FAILED`.
   */
  private errorCode(err: unknown): string {
    if (err instanceof AiRunError) return err.code;
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const { code } = body as { code: unknown };
        if (typeof code === 'string') return code;
      }
    }
    return 'AI_FAILED';
  }

  private logFailure(err: unknown): void {
    this.logger.warn(
      {
        errorClass: err instanceof Error ? err.name : 'UnknownError',
        code: err instanceof AiRunError ? err.code : undefined,
      },
      'ai chat reply failed',
    );
  }
}

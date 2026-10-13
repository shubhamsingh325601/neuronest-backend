import {
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationKind } from '@prisma/client';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';
import { MESSAGE_PAGE_MAX } from '@modules/conversations/shared/message-paging';
import { ConversationEventStream, type StreamFrame } from './conversation-event-stream';

/**
 * A `Last-Event-ID` is a message seq. A missing, malformed, negative or absurd value means "I have
 * nothing": the client then gets the replay (or a resync), which is always safe.
 */
export function parseLastEventId(header: string | undefined): number {
  return header !== undefined && /^\d{1,9}$/.test(header.trim()) ? Number(header.trim()) : 0;
}

export function toMessageEvent(frame: StreamFrame): MessageEvent {
  if (frame.type === 'heartbeat') return { comment: 'hb' };
  return { type: frame.type, id: String(frame.id), data: frame.data };
}

/**
 * Opens the live events stream of a HUMAN conversation for one of its two participants. Everything
 * that can be refused (not a participant, an AI chat, too many streams) is refused by
 * `assertCanOpen`, before the first byte, as an ordinary problem response. The caps are in-process counters (one backend
 * instance, plan 0019 section 3 row 8).
 */
@Injectable()
export class ConversationEventsService {
  private readonly perUser = new Map<string, number>();
  private readonly perConversation = new Map<string, number>();
  private readonly maxPerUser: number;
  private readonly maxPerConversation: number;
  private readonly heartbeatMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ConversationEventBus,
    config: ConfigService<AppConfig, true>,
  ) {
    const conversations = config.get('conversations', { infer: true });
    this.maxPerUser = conversations.maxStreamsPerUser;
    this.maxPerConversation = conversations.maxStreamsPerConversation;
    this.heartbeatMs = conversations.streamHeartbeatMs;
  }

  /**
   * Every refusal, run by {@link ConversationEventsGuard} before the handler. It has to be a guard,
   * not async work inside the `@Sse` handler: Nest commits the SSE headers on the next tick after
   * subscribing, and the global Sentry interceptor turns a rejected handler into an observable
   * error, so a refusal thrown there would reach the client as an `error` event on a 200 stream.
   */
  async assertCanOpen(id: string, caller: AuthenticatedUser): Promise<void> {
    const conversation = await loadParticipantConversation(this.prisma, id, caller);
    if (conversation.kind !== ConversationKind.HUMAN) {
      throw new UnprocessableEntityException({
        code: 'NOT_A_HUMAN_CONVERSATION',
        message: 'Live events exist only for a chat with an expert.',
      });
    }
    if (this.atCapacity(id, caller.id)) throw this.tooMany();
  }

  /** Synchronous on purpose (see {@link assertCanOpen}); the slot is taken when it is subscribed. */
  open(
    id: string,
    caller: AuthenticatedUser,
    lastEventIdHeader: string | undefined,
  ): Observable<MessageEvent> {
    const lastEventId = parseLastEventId(lastEventIdHeader);
    return new Observable<MessageEvent>((subscriber) => {
      // Counted when the stream really starts (Nest skips subscribing if the client already left),
      // so a slot can never be taken and not given back.
      if (this.atCapacity(id, caller.id)) {
        subscriber.error(this.tooMany());
        return undefined;
      }
      this.acquire(id, caller.id);

      const stream = new ConversationEventStream({
        conversationId: id,
        caller,
        lastEventId,
        replayLimit: MESSAGE_PAGE_MAX,
        heartbeatMs: this.heartbeatMs,
        prisma: this.prisma,
        bus: this.bus,
        emit: (frame) => subscriber.next(toMessageEvent(frame)),
        onEnd: () => subscriber.complete(),
      });
      void stream.start();

      return () => {
        stream.dispose();
        this.release(id, caller.id);
      };
    });
  }

  /** Open streams in total, for tests and diagnostics. */
  openStreams(): number {
    let total = 0;
    for (const count of this.perConversation.values()) total += count;
    return total;
  }

  private atCapacity(conversationId: string, userId: string): boolean {
    return (
      (this.perUser.get(userId) ?? 0) >= this.maxPerUser ||
      (this.perConversation.get(conversationId) ?? 0) >= this.maxPerConversation
    );
  }

  private tooMany(): HttpException {
    return new HttpException(
      {
        code: 'TOO_MANY_STREAMS',
        message: 'Too many live connections are open. Close one and try again.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private acquire(conversationId: string, userId: string): void {
    this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);
    this.perConversation.set(conversationId, (this.perConversation.get(conversationId) ?? 0) + 1);
  }

  private release(conversationId: string, userId: string): void {
    this.decrement(this.perUser, userId);
    this.decrement(this.perConversation, conversationId);
  }

  private decrement(counts: Map<string, number>, key: string): void {
    const next = (counts.get(key) ?? 0) - 1;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
  }
}

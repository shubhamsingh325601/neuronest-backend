import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ConversationStatus, UserStatus, type Message } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';
import type { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import { ConversationDto, MessageDto } from '@modules/conversations/shared/conversation.dto';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';

/**
 * What the stream hands to the transport. `id` is the value of the SSE `id:` line, which is the
 * client's `Last-Event-ID` on reconnect, so it must always be a position the client can resume from:
 * a message's own seq, or for the other frames the seq the client already has.
 */
export type StreamFrame =
  | { type: 'heartbeat' }
  | { type: 'message'; id: number; data: MessageDto }
  | { type: 'resync'; id: number; data: { lastSeq: number } }
  | { type: 'closed'; id: number; data: ConversationDto }
  | { type: 'purged'; id: number; data: ConversationDto };

export interface ConversationStreamOptions {
  conversationId: string;
  caller: AuthenticatedUser;
  /** The client's last seen seq (`Last-Event-ID`); 0 when it has none. */
  lastEventId: number;
  /** Most messages replayed on connect, and per catch-up read; more missing means `resync`. */
  replayLimit: number;
  heartbeatMs: number;
  prisma: PrismaService;
  bus: ConversationEventBus;
  emit: (frame: StreamFrame) => void;
  /** Called once when the stream finishes by itself: closed, purged, or access lost. */
  onEnd: () => void;
}

/**
 * One open `GET /conversations/{id}/events` connection (plan 0019 section 3 row 7, section 13 step 6.1).
 * No framework code, so it is tested with a fake clock and a fake database.
 *
 * Correctness comes from reading the database, not from the events. The bus only says "something
 * changed": every wake-up runs a catch-up pass that reads the messages after the last one sent, in
 * order, so there can be no gap and no repeat however events are delayed, doubled or lost:
 *  1. subscribe to the bus first (nothing that happens after this is missed);
 *  2. replay `seq > lastEventId` from the database (a gap larger than `replayLimit` is a `resync`);
 *  3. every later event, and every heartbeat, runs the same catch-up pass; an event whose seq is not
 *     newer than the last one sent is skipped without touching the database.
 * The conversation row is read BEFORE the messages in a pass: a close takes the row lock after the last
 * message committed, so seeing CLOSED first means the messages read next are complete.
 *
 * Nothing here throws once the stream is running: a failure is logged (error class and ids only,
 * never text) and retried by the next heartbeat.
 */
export class ConversationEventStream {
  private readonly logger = new Logger(ConversationEventStream.name);
  private lastSent: number;
  private ended = false;
  private pumping = false;
  private dirty = false;
  private first = true;
  private rechecking = false;
  private unsubscribe: (() => void) | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly o: ConversationStreamOptions) {
    this.lastSent = o.lastEventId;
  }

  /** Starts the stream. Never rejects. */
  async start(): Promise<void> {
    if (this.ended) return;
    this.unsubscribe = this.o.bus.subscribe(this.o.conversationId, (event) => {
      if (this.ended) return;
      if (event.type === 'message-appended' && event.seq <= this.lastSent) return;
      this.dirty = true;
      void this.pump();
    });
    this.timer = setInterval(() => this.onHeartbeat(), this.o.heartbeatMs);
    this.dirty = true;
    await this.pump();
  }

  /** The transport went away: release the timer and the subscription. Safe to call twice. */
  dispose(): void {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private finish(): void {
    if (this.ended) return;
    this.dispose();
    try {
      this.o.onEnd();
    } catch (err) {
      this.logFailure(err, 'ending the stream');
    }
  }

  private send(frame: StreamFrame): void {
    if (this.ended) return;
    try {
      this.o.emit(frame);
    } catch (err) {
      this.logFailure(err, 'writing a frame');
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.ended) return;
    this.pumping = true;
    try {
      while (this.dirty && !this.ended) {
        this.dirty = false;
        await this.pass();
      }
    } catch (err) {
      // A database failure: stay open and let the next heartbeat run the pass again.
      this.logFailure(err, 'reading messages');
    } finally {
      this.pumping = false;
    }
  }

  /** One catch-up pass: everything after `lastSent`, then the end of the stream if it is over. */
  private async pass(): Promise<void> {
    const { prisma, conversationId, replayLimit } = this.o;
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) {
      this.finish();
      return;
    }
    if (conversation.messagesPurgedAt) {
      this.send({ type: 'purged', id: this.lastSent, data: ConversationDto.from(conversation) });
      this.finish();
      return;
    }

    if (this.first) {
      // A client cannot be ahead of the conversation; a made-up id must not hide future messages.
      const from = Math.min(this.lastSent, conversation.lastMessageSeq);
      const rows = await this.messagesAfter(from, replayLimit + 1);
      this.first = false;
      if (rows.length > replayLimit) {
        // Too much was missed to replay here: the client reads GET messages. Live delivery continues
        // after the newest message known now. The frame id stays where the client was, so a
        // reconnect without a GET asks for the same resync again instead of losing the gap.
        this.lastSent = conversation.lastMessageSeq;
        this.send({ type: 'resync', id: from, data: { lastSeq: conversation.lastMessageSeq } });
        this.dirty = true;
        return;
      }
      this.lastSent = from;
      this.sendMessages(rows);
    } else {
      const rows = await this.messagesAfter(this.lastSent, replayLimit);
      this.sendMessages(rows);
      if (rows.length === replayLimit) {
        this.dirty = true;
        return;
      }
    }

    if (conversation.status === ConversationStatus.CLOSED) {
      this.send({ type: 'closed', id: this.lastSent, data: ConversationDto.from(conversation) });
      this.finish();
    }
  }

  private messagesAfter(seq: number, take: number): Promise<Message[]> {
    return this.o.prisma.message.findMany({
      where: { conversationId: this.o.conversationId, seq: { gt: seq } },
      orderBy: { seq: 'asc' },
      take,
    });
  }

  private sendMessages(rows: Message[]): void {
    for (const row of rows) {
      this.send({ type: 'message', id: row.seq, data: MessageDto.from(row) });
      this.lastSent = row.seq;
    }
  }

  private onHeartbeat(): void {
    if (this.ended) return;
    this.send({ type: 'heartbeat' });
    void this.recheck();
  }

  /**
   * On every heartbeat: is this person still allowed (account active, still the participant, an expert
   * still assigned)? If not the stream ends. If so, a changed conversation row starts a catch-up
   * pass, which also repairs an event the bus lost.
   */
  private async recheck(): Promise<void> {
    if (this.rechecking || this.ended) return;
    this.rechecking = true;
    try {
      const { prisma, conversationId, caller } = this.o;
      const user = await prisma.user.findUnique({
        where: { id: caller.id },
        select: { status: true, role: true },
      });
      if (!user || user.status !== UserStatus.ACTIVE || user.role !== caller.role) {
        this.finish();
        return;
      }
      const conversation = await loadParticipantConversation(prisma, conversationId, caller);
      if (this.ended) return;
      if (
        conversation.lastMessageSeq > this.lastSent ||
        conversation.status === ConversationStatus.CLOSED
      ) {
        this.dirty = true;
        void this.pump();
      }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        this.finish();
      } else {
        this.logFailure(err, 'rechecking access');
      }
    } finally {
      this.rechecking = false;
    }
  }

  private logFailure(err: unknown, during: string): void {
    this.logger.warn(
      {
        errorClass: err instanceof Error ? err.name : 'UnknownError',
        conversationId: this.o.conversationId,
        userId: this.o.caller.id,
      },
      `conversation stream failed while ${during}`,
    );
  }
}

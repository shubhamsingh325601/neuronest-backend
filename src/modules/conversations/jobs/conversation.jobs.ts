import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus, SummaryStatus, type Prisma } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { conversationClosed } from '@modules/conversations/shared/conversation-event';
import { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import { enqueueSummary } from './conversation-summary.queue';

export const CLOSE_IDLE_JOB = 'conversation.close-idle';
export const PURGE_JOB = 'conversation.purge';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Chat retention (plan 0019 §8). Both jobs are recurring (hourly dedupe key, so a failing run shows
 * up in the admin DEAD list) and idempotent. The time is a parameter so tests can move the clock.
 * - `conversation.close-idle` closes OPEN sessions with no message for `CONVERSATION_IDLE_CLOSE_HOURS`
 *   (a session that never received a message counts from its creation) and queues each one's summary.
 *   The sweep picks the queued jobs up; this job does not kick the queue it is running in.
 * - `conversation.purge` hard-deletes the raw messages of a CLOSED session once its summary is READY
 *   and it has been closed for `CONVERSATION_PURGE_IDLE_DAYS`, or at `CONVERSATION_PURGE_BACKSTOP_DAYS`
 *   whatever the summary state (a PLACEHOLDER summary is written first).
 */
@Injectable()
export class ConversationJobs implements OnModuleInit {
  private readonly logger = new Logger(ConversationJobs.name);
  private readonly idleCloseMs: number;
  private readonly purgeIdleMs: number;
  private readonly purgeBackstopMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly queue: JobQueueService,
    private readonly bus: ConversationEventBus,
    config: ConfigService<AppConfig, true>,
  ) {
    const conversations = config.get('conversations', { infer: true });
    this.idleCloseMs = conversations.idleCloseHours * HOUR_MS;
    this.purgeIdleMs = conversations.purgeIdleDays * DAY_MS;
    this.purgeBackstopMs = conversations.purgeBackstopDays * DAY_MS;
  }

  onModuleInit(): void {
    this.registry.register(CLOSE_IDLE_JOB, async () => {
      await this.closeIdle();
    });
    this.registry.register(PURGE_JOB, async () => {
      await this.purge();
    });
    for (const type of [CLOSE_IDLE_JOB, PURGE_JOB]) {
      this.registry.registerRecurring({
        type,
        payload: {},
        dedupeKey: (now) => `${type}:${Math.floor(now.getTime() / HOUR_MS)}`,
      });
    }
  }

  /** Returns how many sessions were closed. */
  async closeIdle(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.idleCloseMs);
    const idle: Prisma.ConversationWhereInput = {
      status: ConversationStatus.OPEN,
      OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
    };
    const candidates = await this.prisma.conversation.findMany({
      where: idle,
      select: { id: true, kind: true, childId: true, parentId: true, expertId: true },
    });

    let closed = 0;
    for (const candidate of candidates) {
      // The idle condition is checked again, so a message that just arrived keeps the session open.
      const count = await this.prisma.$transaction(async (tx) => {
        const result = await tx.conversation.updateMany({
          where: { id: candidate.id, ...idle },
          data: { status: ConversationStatus.CLOSED, closedAt: now },
        });
        if (result.count === 1) await enqueueSummary(tx, this.queue, candidate);
        return result.count;
      });
      // After the commit, so a listener that reads the database sees the closed row.
      if (count === 1) this.bus.publish(conversationClosed(candidate, 'IDLE'));
      closed += count;
    }
    if (closed > 0) {
      this.logger.log({ closed }, 'Closed idle conversations');
    }
    return closed;
  }

  /** Returns how many sessions had their messages deleted. */
  async purge(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.conversation.findMany({
      where: {
        status: ConversationStatus.CLOSED,
        messagesPurgedAt: null,
        closedAt: { lte: new Date(now.getTime() - this.purgeIdleMs) },
      },
      select: { id: true, childId: true, closedAt: true, summary: { select: { status: true } } },
    });

    let purged = 0;
    for (const candidate of candidates) {
      const summaryReady = candidate.summary?.status === SummaryStatus.READY;
      const backstopReached =
        !!candidate.closedAt &&
        candidate.closedAt.getTime() <= now.getTime() - this.purgeBackstopMs;
      if (!summaryReady && !backstopReached) continue;

      await this.prisma.$transaction(async (tx) => {
        if (!summaryReady) {
          await tx.conversationSummary.upsert({
            where: { conversationId: candidate.id },
            create: {
              conversationId: candidate.id,
              childId: candidate.childId,
              status: SummaryStatus.PLACEHOLDER,
              failureReason: 'BACKSTOP_REACHED',
            },
            update: { status: SummaryStatus.PLACEHOLDER, failureReason: 'BACKSTOP_REACHED' },
          });
          this.logger.warn({ conversationId: candidate.id }, 'Purged without a ready summary');
        }
        const deleted = await tx.message.deleteMany({ where: { conversationId: candidate.id } });
        await tx.conversation.updateMany({
          where: { id: candidate.id, messagesPurgedAt: null },
          data: { messagesPurgedAt: now, purgedMessageCount: deleted.count },
        });
      });
      purged += 1;
    }
    if (purged > 0) {
      this.logger.log({ purged }, 'Purged conversation messages');
    }
    return purged;
  }
}

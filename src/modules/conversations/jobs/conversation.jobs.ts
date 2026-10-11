import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus, SummaryStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';

export const CLOSE_IDLE_JOB = 'conversation.close-idle';
export const PURGE_JOB = 'conversation.purge';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Chat retention (plan 0019 §8). Both jobs are recurring (hourly dedupe key, so a failing run shows
 * up in the admin DEAD list) and idempotent. The time is a parameter so tests can move the clock.
 * - `conversation.close-idle` closes OPEN sessions with no message for `CONVERSATION_IDLE_CLOSE_HOURS`
 *   (a session that never received a message counts from its creation).
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
    const result = await this.prisma.conversation.updateMany({
      where: {
        status: ConversationStatus.OPEN,
        OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
      },
      data: { status: ConversationStatus.CLOSED, closedAt: now },
    });
    if (result.count > 0) {
      this.logger.log({ closed: result.count }, 'Closed idle conversations');
    }
    return result.count;
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

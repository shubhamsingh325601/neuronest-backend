import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiOutputStatus, Prisma, type AiOutput } from '@prisma/client';
import { AiBudgetService } from '@common/ai/ai-budget.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  COACHING_TIP_CAPABILITY,
  COACHING_TIP_JOB,
  COACHING_TIP_JOB_MAX_ATTEMPTS,
  MAX_GENERATIONS_PER_DAY,
} from '@modules/ai-coaching/shared/ai-coaching.constants';
import { AiCoachingTipDto, isStalePending } from '@modules/ai-coaching/shared/ai-coaching-tip.dto';
import { CoachingTipGenerator } from '@modules/ai-coaching/shared/coaching-tip.generator';
import { coachingTipPrompt } from '@modules/ai-coaching/shared/coaching-tip.request';
import { formatDateOnly, parseDateOnly } from '@modules/progress/shared/date.util';

export interface GenerateCoachingTipResult {
  /** 201 generated now · 200 existing or unavailable · 202 pending (poll the GET). */
  statusCode: 200 | 201 | 202;
  body: AiCoachingTipDto;
}

/** Failures that never reached the provider, so a retry does not spend a generation. */
const NO_SPEND_REASONS = new Set(['CAPACITY', 'DISABLED', 'NO_PLAN', 'ACCESS']);

/**
 * Generate-or-return today's tip (plan 0018 Q8/Q9). The `ai_outputs` row is both the cache and
 * the idempotency record: unique `(childId, capability, forDate)`, state machine
 * `PENDING → READY | FAILED`. The provider is only ever called by the request that wins the
 * claim, so concurrent or repeated POSTs cannot double-spend the quota.
 */
@Injectable()
export class GenerateCoachingTipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: CoachingTipGenerator,
    private readonly budget: AiBudgetService,
    private readonly queue: JobQueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async generate(
    childId: string,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<GenerateCoachingTipResult> {
    // Authorisation, flag and context first: `404 PLAN_NOT_FOUND` etc. surface exactly as they
    // do on the parent's own screens, before any row is written or quota considered.
    const prepared = await this.generator.prepare(childId, caller, now);
    const forDateText = formatDateOnly(now);
    const forDate = parseDateOnly(forDateText);
    const inputHash = prepared.built.inputHash(coachingTipPrompt.version);
    const keyWhere = {
      childId_capability_forDate: { childId, capability: COACHING_TIP_CAPABILITY, forDate },
    };

    const existing = (row: AiOutput): GenerateCoachingTipResult => {
      const body = AiCoachingTipDto.fromRow(row, forDateText, now);
      return { statusCode: body.status === 'PENDING' ? 202 : 200, body };
    };

    let row = await this.prisma.aiOutput.findUnique({ where: keyWhere });
    if (row) {
      const decision = this.decide(row, inputHash, now);
      if (decision === 'existing') return existing(row);
      await this.assertUserLimit(caller.id, now);
      const claimed = await this.prisma.aiOutput.updateMany({
        // Fenced on the exact state we read: a concurrent request that claimed first wins.
        where: { id: row.id, status: row.status, generation: row.generation, updatedAt: row.updatedAt },
        data: {
          status: AiOutputStatus.PENDING,
          generation: decision === 'regenerate' ? row.generation + 1 : row.generation,
          inputHash,
          promptVersion: coachingTipPrompt.version,
          failureReason: null,
          requestedById: caller.id,
        },
      });
      const fresh = await this.reread(keyWhere);
      if (claimed.count === 0) return existing(fresh);
      row = fresh;
    } else {
      await this.assertUserLimit(caller.id, now);
      try {
        row = await this.prisma.aiOutput.create({
          data: {
            childId,
            capability: COACHING_TIP_CAPABILITY,
            forDate,
            inputHash,
            promptVersion: coachingTipPrompt.version,
            requestedById: caller.id,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return existing(await this.reread(keyWhere));
        }
        throw err;
      }
    }

    const claimedRow = row;
    let outcome;
    try {
      outcome = await this.generator.generate(claimedRow, prepared, caller);
    } catch (err) {
      // Not an AiRunError: our own bug or the database. Don't leave a row PENDING for 15 minutes.
      await this.generator.markFailed(claimedRow, 'PROVIDER').catch(() => undefined);
      throw err;
    }

    if (outcome.kind === 'RETRYABLE') {
      await this.enqueueRetry(claimedRow);
      return { statusCode: 202, body: AiCoachingTipDto.pending(forDateText) };
    }
    const fresh = await this.reread(keyWhere);
    const result = existing(fresh);
    return outcome.kind === 'READY' ? { ...result, statusCode: 201 } : result;
  }

  private decide(row: AiOutput, inputHash: string, now: Date): 'existing' | 'regenerate' | 'retry' {
    const canRegenerate = row.generation < MAX_GENERATIONS_PER_DAY;
    switch (row.status) {
      case AiOutputStatus.READY:
        // Same inputs, or the daily cap is used: the stored tip stands (plan 0018 Q8.2).
        return row.inputHash !== inputHash && canRegenerate ? 'regenerate' : 'existing';
      case AiOutputStatus.PENDING:
        // Someone is on it. Only an abandoned row (its job died) may be taken over.
        return isStalePending(row, now) && canRegenerate ? 'regenerate' : 'existing';
      case AiOutputStatus.FAILED:
        if (row.failureReason && NO_SPEND_REASONS.has(row.failureReason)) return 'retry';
        return canRegenerate ? 'regenerate' : 'existing';
    }
  }

  private async assertUserLimit(userId: string, now: Date): Promise<void> {
    const limit = this.config.get('ai', { infer: true }).userDailyLimit;
    if ((await this.budget.generationsByUserToday(userId, now)) >= limit) {
      throw new HttpException(
        {
          code: 'AI_USER_LIMIT_REACHED',
          message: 'You have reached the daily limit for AI coaching tips. Please try again tomorrow.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async reread(where: Prisma.AiOutputWhereUniqueInput): Promise<AiOutput> {
    return this.prisma.aiOutput.findUniqueOrThrow({ where });
  }

  /** Transactional outbox: the job row commits atomically; the kick follows the commit. */
  private async enqueueRetry(row: Pick<AiOutput, 'id' | 'generation'>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.queue.enqueue(tx, {
        type: COACHING_TIP_JOB,
        payload: { outputId: row.id },
        dedupeKey: `ai.coaching-tip:${row.id}:${row.generation}`,
        maxAttempts: COACHING_TIP_JOB_MAX_ATTEMPTS,
      });
    });
    await this.queue.kick();
  }
}

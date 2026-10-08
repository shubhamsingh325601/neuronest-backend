import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiOutputStatus, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { JobHandlerRegistry, type JobContext } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  AI_PRUNE_JOB,
  AI_RUN_RETENTION_DAYS,
  COACHING_TIP_JOB,
  COACHING_TIP_JOB_MAX_ATTEMPTS,
} from '@modules/ai-coaching/shared/ai-coaching.constants';
import { CoachingTipGenerator } from '@modules/ai-coaching/shared/coaching-tip.generator';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Read the `outputId` out of the job payload; a malformed payload is a permanent bug, so throw. */
function payloadOutputId(job: JobContext): string {
  const payload = job.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const outputId = payload['outputId'];
    if (typeof outputId === 'string' && outputId.length > 0) return outputId;
  }
  throw new Error(`Job ${job.id} (${job.type}) has no outputId in its payload`);
}

/**
 * Background side of the AI coaching tip (plan 0018 Q9.4–Q9.8):
 * - `ai.coaching-tip.generate` finishes a generation the request could not. It runs **as the
 *   requesting user** and re-checks authorization, so access is never trusted from enqueue time.
 *   Its payload is `{ outputId }` only; no child data and no secrets.
 * - `ai.prune` (recurring, hourly) deletes expired `ai_outputs` and old `ai_runs`.
 */
@Injectable()
export class AiCoachingJobs implements OnModuleInit {
  private readonly logger = new Logger(AiCoachingJobs.name);
  private readonly outputRetentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly generator: CoachingTipGenerator,
    config: ConfigService<AppConfig, true>,
  ) {
    this.outputRetentionDays = config.get('ai', { infer: true }).outputRetentionDays;
  }

  onModuleInit(): void {
    this.registry.register(COACHING_TIP_JOB, (job) => this.generate(job));
    this.registry.register(AI_PRUNE_JOB, async () => {
      await this.prune();
    });
    this.registry.registerRecurring({
      type: AI_PRUNE_JOB,
      payload: {},
      dedupeKey: (now) => `${AI_PRUNE_JOB}:${Math.floor(now.getTime() / HOUR_MS)}`,
    });
  }

  async generate(job: JobContext): Promise<void> {
    const output = await this.prisma.aiOutput.findUnique({
      where: { id: payloadOutputId(job) },
      include: {
        requestedBy: { select: { id: true, email: true, role: true, status: true } },
      },
    });
    // Gone (child deleted), or already finished by another path: nothing to do.
    if (!output || output.status !== AiOutputStatus.PENDING) return;

    const caller: AuthenticatedUser = output.requestedBy;
    if (caller.status !== UserStatus.ACTIVE) {
      await this.generator.markFailed(output, 'USER_INACTIVE');
      return;
    }

    let prepared;
    try {
      prepared = await this.generator.prepare(output.childId, caller);
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      await this.generator.markFailed(output, CoachingTipGenerator.reasonForHttpError(err));
      return;
    }

    const outcome = await this.generator.generate(output, prepared, caller);
    if (outcome.kind !== 'RETRYABLE') return;

    if (job.attempt >= COACHING_TIP_JOB_MAX_ATTEMPTS) {
      // Out of attempts: give up cleanly rather than leave the row PENDING until it goes stale.
      await this.generator.markFailed(output, outcome.reason);
      return;
    }
    // `AiRunError`'s message is derived from its code, so this is safe for `Job.lastError`.
    throw outcome.error;
  }

  /** Returns how many `ai_outputs` and `ai_runs` rows were deleted. */
  async prune(now: Date = new Date()): Promise<{ outputs: number; runs: number }> {
    const [outputs, runs] = await Promise.all([
      this.prisma.aiOutput.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - this.outputRetentionDays * DAY_MS) } },
      }),
      this.prisma.aiRun.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - AI_RUN_RETENTION_DAYS * DAY_MS) } },
      }),
    ]);
    if (outputs.count > 0 || runs.count > 0) {
      this.logger.log({ outputs: outputs.count, runs: runs.count }, 'Pruned AI records');
    }
    return { outputs: outputs.count, runs: runs.count };
  }
}

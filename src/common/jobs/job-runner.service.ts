import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { computeBackoffMs } from './backoff';
import { JobHandlerRegistry } from './job-handler.registry';
import { utc } from './job-time.util';

export interface RunSummary {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date;
}

type Outcome = 'succeeded' | 'retried' | 'dead' | 'lost';

const HANDLER_TIMEOUT_MS = 60_000;
const MAX_BATCHES_PER_RUN = 20;
const LAST_ERROR_MAX = 1000;

/**
 * Claims and runs due jobs. Safe to call concurrently from any trigger (kick, sweep,
 * boot, admin button, several instances): the claim is a single `FOR UPDATE SKIP LOCKED`
 * statement and every completion is fenced on `(status = RUNNING, lockedAt = claimedAt)`.
 * No explicit transaction and no session advisory locks, so it is pooler-safe.
 */
@Injectable()
export class JobRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(JobRunnerService.name);
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly batchSize: number;
  private readonly visibilityTimeoutSec: number;
  private readonly backoff: { baseSec: number; capSec: number };
  private readonly retentionDays: number;
  private readonly graceMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    const jobs = config.get('jobs', { infer: true });
    this.batchSize = jobs.batchSize;
    this.visibilityTimeoutSec = jobs.visibilityTimeoutSec;
    this.backoff = { baseSec: jobs.backoffBaseSec, capSec: jobs.backoffCapSec };
    this.retentionDays = jobs.succeededRetentionDays;
    this.graceMs = jobs.shutdownGraceSec * 1000;
  }

  /** Process every currently-due job (bounded), returning outcome counts. */
  async runDue(): Promise<RunSummary> {
    const summary: RunSummary = { claimed: 0, succeeded: 0, retried: 0, dead: 0 };
    for (let i = 0; i < MAX_BATCHES_PER_RUN && !this.stopping; i++) {
      const batch = await this.claim(this.batchSize);
      if (batch.length === 0) {
        break;
      }
      summary.claimed += batch.length;
      const outcomes = await Promise.all(batch.map((job) => this.track(this.process(job))));
      for (const outcome of outcomes) {
        if (outcome === 'succeeded') summary.succeeded++;
        else if (outcome === 'retried') summary.retried++;
        else if (outcome === 'dead') summary.dead++;
      }
      if (batch.length < this.batchSize) {
        break;
      }
    }
    return summary;
  }

  /** Single-statement claim; `attempts` increments here so a crash loop still terminates. */
  async claim(limit: number): Promise<ClaimedJob[]> {
    const now = new Date();
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "jobs"
      SET "status" = 'RUNNING'::"JobStatus", "lockedAt" = ${utc(now)}, "lockedBy" = ${this.instanceId},
          "attempts" = "attempts" + 1, "updatedAt" = ${utc(now)}
      WHERE "id" IN (
        SELECT "id" FROM "jobs"
        WHERE "status" = 'PENDING'::"JobStatus" AND "runAt" <= ${utc(now)}
        ORDER BY "priority" DESC, "runAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts", "maxAttempts", "lockedAt"`;
  }

  /**
   * Maintenance pass: return `RUNNING` rows whose lock outlived the visibility timeout
   * (`PENDING`, or `DEAD` once out of attempts) and prune old `SUCCEEDED` rows.
   */
  async reapStale(): Promise<{ reset: number; dead: number; pruned: number }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.visibilityTimeoutSec * 1000);
    const rows = await this.prisma.$queryRaw<{ id: string; type: string; status: JobStatus }[]>`
      UPDATE "jobs"
      SET "status" = (CASE WHEN "attempts" >= "maxAttempts" THEN 'DEAD' ELSE 'PENDING' END)::"JobStatus",
          "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = ${utc(now)},
          "lastError" = 'Visibility timeout exceeded (worker lost)'
      WHERE "status" = 'RUNNING'::"JobStatus" AND "lockedAt" < ${utc(cutoff)}
      RETURNING "id", "type", "status"`;
    const dead = rows.filter((r) => r.status === JobStatus.DEAD);
    for (const row of dead) {
      Sentry.captureMessage(`Job ${row.type} (${row.id}) is DEAD: visibility timeout exceeded`);
    }

    const pruneBefore = new Date(now.getTime() - this.retentionDays * 86_400_000);
    const pruned = await this.prisma.job.deleteMany({
      where: { status: JobStatus.SUCCEEDED, completedAt: { lt: pruneBefore } },
    });
    return { reset: rows.length - dead.length, dead: dead.length, pruned: pruned.count };
  }

  /** Stop claiming, let in-flight jobs finish (up to the grace period), release the rest. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    try {
      if (this.inFlight.size > 0) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.allSettled([...this.inFlight]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.graceMs);
          }),
        ]);
        clearTimeout(timer);
      }
      await this.releaseHeld();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Releasing held jobs on shutdown failed; the visibility timeout will recover them.',
      );
    }
  }

  /** A deploy is not the job's fault: give back the attempt consumed by the claim. */
  async releaseHeld(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "jobs"
      SET "status" = 'PENDING'::"JobStatus", "attempts" = GREATEST("attempts" - 1, 0),
          "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = ${utc(new Date())}
      WHERE "status" = 'RUNNING'::"JobStatus" AND "lockedBy" = ${this.instanceId}`;
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.add(settled);
    void settled.finally(() => this.inFlight.delete(settled));
    return promise;
  }

  private async process(job: ClaimedJob): Promise<Outcome> {
    const started = Date.now();
    try {
      const handler = this.registry.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.type}"`);
      }
      await this.withTimeout(
        handler({ id: job.id, type: job.type, payload: job.payload, attempt: job.attempts }),
      );
    } catch (err) {
      return this.fail(job, err, started);
    }
    const fenced = await this.prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.RUNNING, lockedAt: job.lockedAt },
      data: {
        status: JobStatus.SUCCEEDED,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
    const outcome: Outcome = fenced.count === 1 ? 'succeeded' : 'lost';
    this.logOutcome(job, outcome, started);
    return outcome;
  }

  private async fail(job: ClaimedJob, err: unknown, started: number): Promise<Outcome> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, LAST_ERROR_MAX);
    const exhausted = job.attempts >= job.maxAttempts;
    const fenced = await this.prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.RUNNING, lockedAt: job.lockedAt },
      data: exhausted
        ? { status: JobStatus.DEAD, lastError: message, lockedAt: null, lockedBy: null }
        : {
            status: JobStatus.PENDING,
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            runAt: new Date(Date.now() + computeBackoffMs(job.attempts, this.backoff)),
          },
    });
    if (fenced.count !== 1) {
      this.logOutcome(job, 'lost', started);
      return 'lost';
    }
    if (exhausted) {
      // Sentry only when a job turns DEAD — not on every retry.
      Sentry.captureException(err instanceof Error ? err : new Error(message), {
        extra: { jobId: job.id, type: job.type, attempts: job.attempts },
      });
    }
    const outcome: Outcome = exhausted ? 'dead' : 'retried';
    this.logOutcome(job, outcome, started, message);
    return outcome;
  }

  private withTimeout(work: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Job handler timed out after ${HANDLER_TIMEOUT_MS}ms`)),
        HANDLER_TIMEOUT_MS,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  private logOutcome(job: ClaimedJob, outcome: Outcome, started: number, error?: string): void {
    const line = {
      jobId: job.id,
      type: job.type,
      attempt: job.attempts,
      durationMs: Date.now() - started,
      outcome,
      ...(error ? { error } : {}),
    };
    if (outcome === 'succeeded') {
      this.logger.log(line, 'job finished');
    } else {
      this.logger.warn(line, 'job finished');
    }
  }
}

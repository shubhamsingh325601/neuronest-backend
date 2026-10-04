import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { utc } from './job-time.util';
import { JobRunnerService } from './job-runner.service';

export interface EnqueueSpec {
  type: string;
  /** Must never contain a secret (cardinal rule 7) — handlers mint tokens at run time. */
  payload: Prisma.InputJsonValue;
  /** Makes the enqueue idempotent: a second insert with the same key is a no-op. */
  dedupeKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

/**
 * Transactional outbox entry point. `enqueue` takes the caller's transaction client so the
 * job row commits atomically with the business data; `kick` is called AFTER commit.
 */
@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly defaultMaxAttempts: number;
  private readonly inline: boolean;
  private loop: Promise<void> | null = null;
  private rerun = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly runner: JobRunnerService,
    config: ConfigService<AppConfig, true>,
  ) {
    const jobs = config.get('jobs', { infer: true });
    this.defaultMaxAttempts = jobs.maxAttempts;
    this.inline = jobs.kickMode === 'inline';
  }

  /** Returns true when a row was inserted, false when `dedupeKey` already existed. */
  async enqueue(db: Prisma.TransactionClient, spec: EnqueueSpec): Promise<boolean> {
    if (!this.registry.has(spec.type)) {
      throw new Error(`Unknown job type "${spec.type}"`);
    }
    const now = new Date();
    const inserted = await db.$executeRaw`
      INSERT INTO "jobs" ("id", "type", "payload", "priority", "runAt", "maxAttempts", "dedupeKey", "createdAt", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${spec.type}, ${JSON.stringify(spec.payload)}::jsonb,
              ${spec.priority ?? 0}, ${utc(spec.runAt ?? now)}, ${spec.maxAttempts ?? this.defaultMaxAttempts},
              ${spec.dedupeKey ?? null}, ${utc(now)}, ${utc(now)})
      ON CONFLICT ("dedupeKey") DO NOTHING`;
    return inserted === 1;
  }

  /**
   * Post-commit nudge to process due jobs now. Never throws into the request and is never
   * required for correctness (the sweep / boot catch-up / admin trigger also pick jobs up).
   * Coalesced to one loop per process. In `inline` mode (tests) the returned promise
   * resolves when the loop is done; otherwise it resolves immediately.
   */
  kick(): Promise<void> {
    const done = this.runLoop();
    return this.inline ? done : Promise.resolve();
  }

  private runLoop(): Promise<void> {
    if (this.loop) {
      this.rerun = true;
      return this.loop;
    }
    this.loop = (async () => {
      try {
        do {
          this.rerun = false;
          await this.runner.runDue();
        } while (this.rerun);
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Job kick failed; the sweep will retry.',
        );
      } finally {
        this.loop = null;
      }
    })();
    return this.loop;
  }
}

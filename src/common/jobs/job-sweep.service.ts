import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import { JobRunnerService } from './job-runner.service';

const SWEEP_CRON_NAME = 'jobs-sweep';
const BOOT_DELAY_MS = 1000;

/**
 * The time-driven triggers: a cron sweep and a boot catch-up. Neither is the source of
 * truth — `runAt` in Postgres is — so a missed tick (sleeping host, restart) only delays
 * work until the next start/request/admin trigger. Disabled with `JOBS_ENABLED=false`.
 */
@Injectable()
export class JobSweepService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobSweepService.name);
  private readonly enabled: boolean;
  private readonly cron: string;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    private readonly runner: JobRunnerService,
    private readonly queue: JobQueueService,
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    const jobs = config.get('jobs', { infer: true });
    this.enabled = jobs.enabled;
    this.cron = jobs.sweepCron;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }
    const job = new CronJob(this.cron, () => void this.sweep());
    this.scheduler.addCronJob(SWEEP_CRON_NAME, job);
    job.start();
  }

  /** Runs after init and before listen(); defers the catch-up so startup is never blocked. */
  onApplicationBootstrap(): void {
    if (!this.enabled) {
      return;
    }
    this.bootTimer = setTimeout(() => void this.sweep(), BOOT_DELAY_MS);
    this.bootTimer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.bootTimer);
    if (this.enabled && this.scheduler.doesExist('cron', SWEEP_CRON_NAME)) {
      this.scheduler.deleteCronJob(SWEEP_CRON_NAME);
    }
  }

  /** Reap stale locks and prune, enqueue recurring jobs, then run everything due. Never throws. */
  async sweep(): Promise<void> {
    try {
      await this.runner.reapStale();
      const now = new Date();
      for (const recurring of this.registry.recurringJobs()) {
        await this.queue.enqueue(this.prisma, {
          type: recurring.type,
          payload: recurring.payload,
          dedupeKey: recurring.dedupeKey(now),
        });
      }
      await this.runner.runDue();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Job sweep failed; the next trigger will retry.',
      );
    }
  }
}

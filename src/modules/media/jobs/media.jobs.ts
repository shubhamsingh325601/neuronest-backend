import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';

export const EXPIRE_STALE_PENDING_JOB = 'media.expire-stale-pending';

const HOUR_MS = 3_600_000;

/**
 * B-8: an upload ticket the parent never confirmed stays `PENDING` forever. This recurring
 * job (enqueued by the sweep with an hourly `dedupeKey`, so a failing run shows up in the
 * admin DEAD list) flips tickets older than `MEDIA_PENDING_TTL_HOURS` to `FAILED`.
 * Idempotent: it only touches `PENDING` rows, so running twice is a no-op. Existing confirm
 * behaviour is preserved — re-confirming FAILED with FAILED is a no-op; UPLOADED after FAILED
 * is `409 MEDIA_ALREADY_CONFIRMED` (the parent requests a new ticket).
 */
@Injectable()
export class MediaJobs implements OnModuleInit {
  private readonly logger = new Logger(MediaJobs.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlMs = config.get('media', { infer: true }).pendingTtlHours * HOUR_MS;
  }

  onModuleInit(): void {
    this.registry.register(EXPIRE_STALE_PENDING_JOB, async () => {
      await this.expireStalePending();
    });
    this.registry.registerRecurring({
      type: EXPIRE_STALE_PENDING_JOB,
      payload: {},
      dedupeKey: (now) => `${EXPIRE_STALE_PENDING_JOB}:${Math.floor(now.getTime() / HOUR_MS)}`,
    });
  }

  /** Returns how many tickets were expired. */
  async expireStalePending(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.media.updateMany({
      where: {
        status: MediaStatus.PENDING,
        createdAt: { lt: new Date(now.getTime() - this.ttlMs) },
      },
      data: { status: MediaStatus.FAILED },
    });
    if (result.count > 0) {
      this.logger.log({ expired: result.count }, 'Expired stale PENDING media tickets');
    }
    return result.count;
  }
}

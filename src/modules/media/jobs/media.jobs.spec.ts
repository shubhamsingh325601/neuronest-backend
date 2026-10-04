import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MediaStatus } from '@prisma/client';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';
import { EXPIRE_STALE_PENDING_JOB, MediaJobs } from './media.jobs';

describe('MediaJobs', () => {
  const prisma = { media: { updateMany: jest.fn() } };
  let registry: JobHandlerRegistry;
  let jobs: MediaJobs;

  beforeEach(async () => {
    jest.resetAllMocks();
    registry = new JobHandlerRegistry();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaJobs,
        { provide: PrismaService, useValue: prisma },
        { provide: JobHandlerRegistry, useValue: registry },
        { provide: ConfigService, useValue: { get: () => ({ pendingTtlHours: 24 }) } },
      ],
    }).compile();
    jobs = moduleRef.get(MediaJobs);
    jobs.onModuleInit();
  });

  it('expires only PENDING rows older than the TTL', async () => {
    prisma.media.updateMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-10-04T12:00:00.000Z');

    await expect(jobs.expireStalePending(now)).resolves.toBe(3);

    expect(prisma.media.updateMany).toHaveBeenCalledWith({
      where: {
        status: MediaStatus.PENDING,
        createdAt: { lt: new Date('2026-10-03T12:00:00.000Z') },
      },
      data: { status: MediaStatus.FAILED },
    });
  });

  it('registers a handler and an hourly-bucketed recurring job', async () => {
    prisma.media.updateMany.mockResolvedValue({ count: 0 });
    await registry.get(EXPIRE_STALE_PENDING_JOB)!({
      id: 'j',
      type: EXPIRE_STALE_PENDING_JOB,
      payload: {},
      attempt: 1,
    });
    expect(prisma.media.updateMany).toHaveBeenCalledTimes(1);

    const [recurring] = registry.recurringJobs();
    const a = recurring.dedupeKey(new Date('2026-10-04T12:05:00.000Z'));
    const b = recurring.dedupeKey(new Date('2026-10-04T12:55:00.000Z'));
    const c = recurring.dedupeKey(new Date('2026-10-04T13:05:00.000Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

import type { ConfigService } from '@nestjs/config';
import { JobStatus } from '@prisma/client';
import type { PrismaService } from '@common/prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobRunnerService, type ClaimedJob } from './job-runner.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const lockedAt = new Date('2026-01-01T00:00:00.000Z');
const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 'j1',
  type: 'known',
  payload: { userId: 'u1' },
  attempts: 1,
  maxAttempts: 3,
  lockedAt,
  ...over,
});

describe('JobRunnerService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    job: { updateMany: jest.fn(), deleteMany: jest.fn() },
  };
  const config = {
    get: () => ({
      batchSize: 10,
      visibilityTimeoutSec: 300,
      backoffBaseSec: 30,
      backoffCapSec: 3600,
      succeededRetentionDays: 14,
      shutdownGraceSec: 1,
    }),
  } as unknown as ConfigService<never, true>;
  let registry: JobHandlerRegistry;
  let runner: JobRunnerService;

  beforeEach(() => {
    jest.resetAllMocks();
    registry = new JobHandlerRegistry();
    runner = new JobRunnerService(prisma as unknown as PrismaService, registry, config as never);
    prisma.job.updateMany.mockResolvedValue({ count: 1 });
  });

  it('runs a claimed job and marks it SUCCEEDED with a fenced update', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registry.register('known', handler);
    prisma.$queryRaw.mockResolvedValueOnce([job()]);

    const summary = await runner.runDue();

    expect(summary).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'j1', payload: { userId: 'u1' }, attempt: 1 }),
    );
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'j1', status: JobStatus.RUNNING, lockedAt },
        data: expect.objectContaining({ status: JobStatus.SUCCEEDED }),
      }),
    );
  });

  it('reschedules a failing job with a future runAt and a truncated lastError', async () => {
    registry.register('known', jest.fn().mockRejectedValue(new Error('x'.repeat(2000))));
    prisma.$queryRaw.mockResolvedValueOnce([job()]);

    const before = Date.now();
    const summary = await runner.runDue();

    expect(summary).toMatchObject({ claimed: 1, retried: 1, dead: 0 });
    const data = prisma.job.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe(JobStatus.PENDING);
    expect(data.lastError).toHaveLength(1000);
    expect(data.runAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it('marks the job DEAD and notifies Sentry once attempts are exhausted', async () => {
    const Sentry = jest.requireMock('@sentry/nestjs');
    registry.register('known', jest.fn().mockRejectedValue(new Error('boom')));
    prisma.$queryRaw.mockResolvedValueOnce([job({ attempts: 3 })]);

    const summary = await runner.runDue();

    expect(summary).toMatchObject({ dead: 1, retried: 0 });
    expect(prisma.job.updateMany.mock.calls[0][0].data.status).toBe(JobStatus.DEAD);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('does not notify Sentry on a retry', async () => {
    const Sentry = jest.requireMock('@sentry/nestjs');
    registry.register('known', jest.fn().mockRejectedValue(new Error('boom')));
    prisma.$queryRaw.mockResolvedValueOnce([job()]);
    await runner.runDue();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('treats an unregistered type as a failure', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([job({ type: 'ghost' })]);
    const summary = await runner.runDue();
    expect(summary.retried).toBe(1);
    expect(prisma.job.updateMany.mock.calls[0][0].data.lastError).toMatch(/No handler/);
  });

  it('reports a lost fence (stale worker) without counting an outcome', async () => {
    registry.register('known', jest.fn().mockResolvedValue(undefined));
    prisma.$queryRaw.mockResolvedValueOnce([job()]);
    prisma.job.updateMany.mockResolvedValue({ count: 0 });

    const summary = await runner.runDue();

    expect(summary).toEqual({ claimed: 1, succeeded: 0, retried: 0, dead: 0 });
  });

  it('stops claiming after a short batch', async () => {
    registry.register('known', jest.fn().mockResolvedValue(undefined));
    prisma.$queryRaw.mockResolvedValueOnce([job()]);
    await runner.runDue();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('claims nothing once shutting down', async () => {
    await runner.onModuleDestroy();
    const summary = await runner.runDue();
    expect(summary.claimed).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('releases its held jobs on shutdown', async () => {
    prisma.$executeRaw.mockResolvedValue(2);
    await runner.onModuleDestroy();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('reapStale reports resets, notifies for DEAD, and prunes old successes', async () => {
    const Sentry = jest.requireMock('@sentry/nestjs');
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', type: 'known', status: JobStatus.PENDING },
      { id: 'b', type: 'known', status: JobStatus.DEAD },
    ]);
    prisma.job.deleteMany.mockResolvedValue({ count: 4 });

    const result = await runner.reapStale();

    expect(result).toEqual({ reset: 1, dead: 1, pruned: 4 });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});

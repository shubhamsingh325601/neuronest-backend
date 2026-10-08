import { HttpException } from '@nestjs/common';
import { AiOutputStatus, Role, UserStatus } from '@prisma/client';
import { AiRunError } from '@common/ai/ai.service';
import { JobHandlerRegistry, type JobContext } from '@common/jobs/job-handler.registry';
import { AiCoachingJobs } from './ai-coaching.jobs';

const requester = {
  id: 'parent-1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'out-1',
  childId: 'child-1',
  status: AiOutputStatus.PENDING,
  content: null,
  requestedBy: requester,
  ...overrides,
});
const job = (attempt = 1, payload: unknown = { outputId: 'out-1' }): JobContext => ({
  id: 'job-1',
  type: 'ai.coaching-tip.generate',
  payload: payload as never,
  attempt,
});

function make() {
  const prisma = {
    aiOutput: { findUnique: jest.fn().mockResolvedValue(pendingRow()), deleteMany: jest.fn() },
    aiRun: { deleteMany: jest.fn() },
  };
  const registry = new JobHandlerRegistry();
  const generator = {
    prepare: jest.fn().mockResolvedValue({ prepared: true }),
    generate: jest.fn().mockResolvedValue({ kind: 'READY' }),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: () => ({ outputRetentionDays: 14 }) };
  const jobs = new AiCoachingJobs(
    prisma as never,
    registry,
    generator as never,
    config as never,
  );
  return { jobs, prisma, registry, generator };
}

describe('AiCoachingJobs', () => {
  it('registers the generate handler, the prune handler and an hourly recurring prune', () => {
    const { jobs, registry } = make();

    jobs.onModuleInit();

    expect(registry.has('ai.coaching-tip.generate')).toBe(true);
    expect(registry.has('ai.prune')).toBe(true);
    const [recurring] = registry.recurringJobs();
    expect(recurring.type).toBe('ai.prune');
    const key = recurring.dedupeKey(new Date('2026-10-05T10:20:00Z'));
    expect(key).toBe(recurring.dedupeKey(new Date('2026-10-05T10:59:00Z')));
    expect(key).not.toBe(recurring.dedupeKey(new Date('2026-10-05T11:00:00Z')));
  });

  describe('generate', () => {
    it('runs as the requesting user: re-authorises and generates with that identity', async () => {
      const { jobs, generator } = make();

      await jobs.generate(job());

      expect(generator.prepare).toHaveBeenCalledWith('child-1', requester);
      expect(generator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'out-1' }),
        { prepared: true },
        requester,
      );
    });

    it.each([
      ['a missing row', null],
      ['a READY row', pendingRow({ status: AiOutputStatus.READY })],
      ['a FAILED row', pendingRow({ status: AiOutputStatus.FAILED })],
    ])('is a no-op for %s', async (_label, found) => {
      const { jobs, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(found);

      await jobs.generate(job());

      expect(generator.prepare).not.toHaveBeenCalled();
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('aborts to FAILED when the requester is no longer ACTIVE, without any provider call', async () => {
      const { jobs, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        pendingRow({ requestedBy: { ...requester, status: UserStatus.SUSPENDED } }),
      );

      await jobs.generate(job());

      expect(generator.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'out-1' }),
        'USER_INACTIVE',
      );
      expect(generator.prepare).not.toHaveBeenCalled();
    });

    it('marks FAILED (not retry) when authorization or the plan is gone by run time', async () => {
      const { jobs, generator } = make();
      generator.prepare.mockRejectedValue(
        new HttpException({ code: 'PLAN_NOT_FOUND', message: 'none' }, 404),
      );

      await jobs.generate(job());

      expect(generator.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'out-1' }),
        'NO_PLAN',
      );
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('rethrows non-HTTP errors from prepare so the job retries', async () => {
      const { jobs, generator } = make();
      generator.prepare.mockRejectedValue(new Error('db down'));

      await expect(jobs.generate(job())).rejects.toThrow('db down');
    });

    it('a retryable failure throws the AiRunError so the runner backs off and retries', async () => {
      const { jobs, generator } = make();
      const error = new AiRunError('AI_PROVIDER', { retryable: true, httpStatus: 503 });
      generator.generate.mockResolvedValue({ kind: 'RETRYABLE', reason: 'PROVIDER', error });

      const thrown = await jobs.generate(job(1)).catch((e: unknown) => e);

      expect(thrown).toBe(error);
      expect((thrown as Error).message).toBe('AI run failed: AI_PROVIDER');
      expect(generator.markFailed).not.toHaveBeenCalled();
    });

    it('on the last attempt it gives up cleanly instead of leaving the row PENDING', async () => {
      const { jobs, generator } = make();
      generator.generate.mockResolvedValue({
        kind: 'RETRYABLE',
        reason: 'PROVIDER',
        error: new AiRunError('AI_TIMEOUT', { retryable: true }),
      });

      await expect(jobs.generate(job(3))).resolves.toBeUndefined();

      expect(generator.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'out-1' }),
        'PROVIDER',
      );
    });

    it('rejects a payload without an outputId', async () => {
      const { jobs } = make();
      await expect(jobs.generate(job(1, {}))).rejects.toThrow('no outputId');
    });
  });

  describe('prune', () => {
    it('deletes outputs past the retention window and runs older than 90 days', async () => {
      const { jobs, prisma } = make();
      prisma.aiOutput.deleteMany.mockResolvedValue({ count: 4 });
      prisma.aiRun.deleteMany.mockResolvedValue({ count: 9 });
      const now = new Date('2026-10-05T10:00:00Z');

      await expect(jobs.prune(now)).resolves.toEqual({ outputs: 4, runs: 9 });

      expect(prisma.aiOutput.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date('2026-09-21T10:00:00Z') } },
      });
      expect(prisma.aiRun.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date('2026-07-07T10:00:00Z') } },
      });
    });
  });
});

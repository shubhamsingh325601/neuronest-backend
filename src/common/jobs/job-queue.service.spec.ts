import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '@common/prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import type { JobRunnerService } from './job-runner.service';

function build(kickMode: 'async' | 'inline') {
  const registry = new JobHandlerRegistry();
  registry.register('known', jest.fn());
  const runner = { runDue: jest.fn().mockResolvedValue({}) };
  const config = { get: () => ({ maxAttempts: 5, kickMode }) } as unknown as ConfigService<
    never,
    true
  >;
  const service = new JobQueueService(
    {} as PrismaService,
    registry,
    runner as unknown as JobRunnerService,
    config as never,
  );
  return { service, runner };
}

describe('JobQueueService', () => {
  describe('enqueue', () => {
    it('reports an insert, and a dedupe no-op', async () => {
      const { service } = build('async');
      const executeRaw = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      const db = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;

      expect(await service.enqueue(db, { type: 'known', payload: {}, dedupeKey: 'k' })).toBe(true);
      expect(await service.enqueue(db, { type: 'known', payload: {}, dedupeKey: 'k' })).toBe(false);
    });

    it('rejects an unregistered job type', async () => {
      const { service } = build('async');
      const executeRaw = jest.fn();
      const db = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
      await expect(service.enqueue(db, { type: 'nope', payload: {} })).rejects.toThrow(
        /Unknown job type/,
      );
      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('kick', () => {
    it('inline mode awaits the run', async () => {
      const { service, runner } = build('inline');
      await service.kick();
      expect(runner.runDue).toHaveBeenCalledTimes(1);
    });

    it('async mode resolves immediately and never throws', async () => {
      const { service, runner } = build('async');
      runner.runDue.mockRejectedValue(new Error('db down'));
      await expect(service.kick()).resolves.toBeUndefined();
      // let the floating loop settle without an unhandled rejection
      await new Promise((r) => setImmediate(r));
      expect(runner.runDue).toHaveBeenCalledTimes(1);
    });

    it('coalesces overlapping kicks into one loop plus one re-run', async () => {
      const { service, runner } = build('inline');
      let release!: () => void;
      runner.runDue.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({}))),
      );
      const first = service.kick();
      const second = service.kick();
      const third = service.kick();
      release();
      await Promise.all([first, second, third]);
      expect(runner.runDue).toHaveBeenCalledTimes(2);
    });
  });
});

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConversationStatus, SummaryStatus } from '@prisma/client';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { SUMMARISE_JOB } from './conversation-summary.queue';
import { CLOSE_IDLE_JOB, ConversationJobs, PURGE_JOB } from './conversation.jobs';

describe('ConversationJobs', () => {
  const tx = {
    conversationSummary: { upsert: jest.fn(), createMany: jest.fn() },
    message: { deleteMany: jest.fn() },
    conversation: { updateMany: jest.fn() },
  };
  const queue = { enqueue: jest.fn(), kick: jest.fn() };
  const prisma = {
    conversation: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  let registry: JobHandlerRegistry;
  let jobs: ConversationJobs;
  const now = new Date('2026-11-20T12:00:00.000Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    tx.message.deleteMany.mockResolvedValue({ count: 3 });
    registry = new JobHandlerRegistry();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationJobs,
        { provide: PrismaService, useValue: prisma },
        { provide: JobHandlerRegistry, useValue: registry },
        { provide: JobQueueService, useValue: queue },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({ idleCloseHours: 24, purgeIdleDays: 7, purgeBackstopDays: 30 }),
          },
        },
      ],
    }).compile();
    jobs = moduleRef.get(ConversationJobs);
    jobs.onModuleInit();
  });

  describe('closeIdle', () => {
    const cutoff = new Date('2026-11-19T12:00:00.000Z');
    const idleWhere = {
      status: ConversationStatus.OPEN,
      OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
    };

    it('closes OPEN sessions idle past the cutoff, counting an empty session from its creation, and queues each summary', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'c-1', childId: 'child-1' },
        { id: 'c-2', childId: 'child-2' },
      ]);
      tx.conversation.updateMany.mockResolvedValue({ count: 1 });

      await expect(jobs.closeIdle(now)).resolves.toBe(2);

      expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual(idleWhere);
      expect(tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', ...idleWhere },
        data: { status: ConversationStatus.CLOSED, closedAt: now },
      });
      expect(tx.conversationSummary.createMany).toHaveBeenCalledWith({
        data: [{ conversationId: 'c-1', childId: 'child-1' }],
        skipDuplicates: true,
      });
      expect(queue.enqueue).toHaveBeenCalledTimes(2);
      expect(queue.enqueue).toHaveBeenCalledWith(tx, {
        type: SUMMARISE_JOB,
        payload: { conversationId: 'c-1' },
        dedupeKey: 'summary:c-1',
        maxAttempts: 3,
      });
      // A job must not kick the queue it is running in.
      expect(queue.kick).not.toHaveBeenCalled();
    });

    it('does not queue a summary for a session that received a message in the meantime', async () => {
      prisma.conversation.findMany.mockResolvedValue([{ id: 'c-1', childId: 'child-1' }]);
      tx.conversation.updateMany.mockResolvedValue({ count: 0 });

      await expect(jobs.closeIdle(now)).resolves.toBe(0);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('purge', () => {
    const candidate = (closedDaysAgo: number, summary: SummaryStatus | null) => ({
      id: `c-${closedDaysAgo}-${summary}`,
      childId: 'child-1',
      closedAt: daysAgo(closedDaysAgo),
      summary: summary ? { status: summary } : null,
    });

    it('only looks at sessions closed at least PURGE_IDLE_DAYS ago and not yet purged', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      await jobs.purge(now);
      expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
        status: ConversationStatus.CLOSED,
        messagesPurgedAt: null,
        closedAt: { lte: daysAgo(7) },
      });
    });

    it('purges a READY session, keeping its summary and recording the audit fields', async () => {
      const ready = candidate(8, SummaryStatus.READY);
      prisma.conversation.findMany.mockResolvedValue([ready]);

      await expect(jobs.purge(now)).resolves.toBe(1);

      expect(tx.conversationSummary.upsert).not.toHaveBeenCalled();
      expect(tx.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: ready.id } });
      expect(tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: ready.id, messagesPurgedAt: null },
        data: { messagesPurgedAt: now, purgedMessageCount: 3 },
      });
    });

    it.each([
      ['no summary', null],
      ['a PENDING summary', SummaryStatus.PENDING],
      ['a FAILED summary', SummaryStatus.FAILED],
    ])('leaves a session with %s alone before the backstop', async (_name, summary) => {
      prisma.conversation.findMany.mockResolvedValue([candidate(29, summary)]);
      await expect(jobs.purge(now)).resolves.toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes a PLACEHOLDER summary and purges at the backstop', async () => {
      const stuck = candidate(30, SummaryStatus.FAILED);
      prisma.conversation.findMany.mockResolvedValue([stuck]);

      await expect(jobs.purge(now)).resolves.toBe(1);

      expect(tx.conversationSummary.upsert).toHaveBeenCalledWith({
        where: { conversationId: stuck.id },
        create: {
          conversationId: stuck.id,
          childId: 'child-1',
          status: SummaryStatus.PLACEHOLDER,
          failureReason: 'BACKSTOP_REACHED',
        },
        update: { status: SummaryStatus.PLACEHOLDER, failureReason: 'BACKSTOP_REACHED' },
      });
      expect(tx.message.deleteMany).toHaveBeenCalledTimes(1);
    });
  });

  it('registers both handlers and an hourly-bucketed recurring job for each', () => {
    expect(registry.has(CLOSE_IDLE_JOB)).toBe(true);
    expect(registry.has(PURGE_JOB)).toBe(true);
    const recurring = registry.recurringJobs();
    expect(recurring.map((r) => r.type)).toEqual([CLOSE_IDLE_JOB, PURGE_JOB]);
    for (const job of recurring) {
      const a = job.dedupeKey(new Date('2026-10-04T12:05:00.000Z'));
      expect(a).toBe(job.dedupeKey(new Date('2026-10-04T12:55:00.000Z')));
      expect(a).not.toBe(job.dedupeKey(new Date('2026-10-04T13:05:00.000Z')));
    }
  });
});

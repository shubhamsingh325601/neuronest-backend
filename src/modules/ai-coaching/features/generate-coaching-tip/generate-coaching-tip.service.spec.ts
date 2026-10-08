import { HttpException, HttpStatus } from '@nestjs/common';
import { AiOutputStatus, Prisma, Role, UserStatus, type AiOutput } from '@prisma/client';
import { AiRunError } from '@common/ai/ai.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { coachingTipPrompt } from '@modules/ai-coaching/shared/coaching-tip.request';
import { GenerateCoachingTipService } from './generate-coaching-tip.service';

const now = new Date('2026-10-05T10:00:00Z');
const caller: AuthenticatedUser = {
  id: 'parent-1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const HASH = 'hash-now';
const tip = { headline: 'A calm start', body: 'Dim the lights.', tryThis: ['Dim the lights.'] };

function row(overrides: Partial<AiOutput> = {}): AiOutput {
  return {
    id: 'out-1',
    childId: 'child-1',
    capability: 'coaching-tip',
    forDate: new Date('2026-10-05T00:00:00Z'),
    status: AiOutputStatus.PENDING,
    generation: 1,
    inputHash: HASH,
    promptVersion: 1,
    provider: null,
    model: null,
    content: null,
    failureReason: null,
    requestedById: 'parent-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function make() {
  const prisma = {
    aiOutput: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  };
  const generator = {
    prepare: jest.fn().mockResolvedValue({
      child: { id: 'child-1' },
      built: { inputHash: jest.fn().mockReturnValue(HASH), nameTokens: [], context: {} },
    }),
    generate: jest.fn().mockResolvedValue({ kind: 'READY' }),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const budget = { generationsByUserToday: jest.fn().mockResolvedValue(0) };
  const queue = { enqueue: jest.fn().mockResolvedValue(true), kick: jest.fn() };
  const config = { get: () => ({ userDailyLimit: 3 }) };
  const service = new GenerateCoachingTipService(
    prisma as never,
    generator as never,
    budget as never,
    queue as never,
    config as never,
  );
  return { service, prisma, generator, budget, queue };
}

describe('GenerateCoachingTipService', () => {
  describe('no row yet', () => {
    it('claims the day with a PENDING row, generates, and answers 201 with the tip', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      prisma.aiOutput.create.mockResolvedValue(row());
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(
        row({ status: AiOutputStatus.READY, content: tip }),
      );

      const result = await service.generate('child-1', caller, now);

      expect(prisma.aiOutput.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          childId: 'child-1',
          capability: 'coaching-tip',
          forDate: new Date('2026-10-05T00:00:00Z'),
          inputHash: HASH,
          promptVersion: coachingTipPrompt.version,
          requestedById: 'parent-1',
        }),
      });
      expect(generator.generate).toHaveBeenCalledTimes(1);
      expect(result.statusCode).toBe(201);
      expect(result.body).toMatchObject({ status: 'READY', tip, aiGenerated: true });
    });

    it('refuses with 429 AI_USER_LIMIT_REACHED before writing or calling the provider', async () => {
      const { service, prisma, generator, budget } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      budget.generationsByUserToday.mockResolvedValue(3);

      const err = await service.generate('child-1', caller, now).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'AI_USER_LIMIT_REACHED' });
      expect(prisma.aiOutput.create).not.toHaveBeenCalled();
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('treats a unique-violation race as "someone else is generating": 202, no provider call', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      prisma.aiOutput.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(row());

      const result = await service.generate('child-1', caller, now);

      expect(result).toMatchObject({ statusCode: 202, body: { status: 'PENDING', tip: null } });
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('rethrows other database errors', async () => {
      const { service, prisma } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      prisma.aiOutput.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.generate('child-1', caller, now)).rejects.toThrow('connection lost');
    });
  });

  describe('existing row', () => {
    it('READY with unchanged inputs: 200, no provider call, no user-limit charge', async () => {
      const { service, prisma, generator, budget } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.READY, content: tip }),
      );

      const result = await service.generate('child-1', caller, now);

      expect(result).toMatchObject({ statusCode: 200, body: { status: 'READY', tip } });
      expect(generator.generate).not.toHaveBeenCalled();
      expect(budget.generationsByUserToday).not.toHaveBeenCalled();
    });

    it('READY with changed inputs and generation 1: regenerates once (generation 2)', async () => {
      const { service, prisma, generator } = make();
      const ready = row({ status: AiOutputStatus.READY, content: tip, inputHash: 'old' });
      prisma.aiOutput.findUnique.mockResolvedValue(ready);
      prisma.aiOutput.updateMany.mockResolvedValue({ count: 1 });
      prisma.aiOutput.findUniqueOrThrow
        .mockResolvedValueOnce(row({ generation: 2, content: tip }))
        .mockResolvedValueOnce(row({ generation: 2, status: AiOutputStatus.READY, content: tip }));

      const result = await service.generate('child-1', caller, now);

      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'out-1',
          status: AiOutputStatus.READY,
          generation: 1,
          updatedAt: ready.updatedAt,
        },
        data: expect.objectContaining({
          status: AiOutputStatus.PENDING,
          generation: 2,
          inputHash: HASH,
          failureReason: null,
          requestedById: 'parent-1',
        }),
      });
      expect(generator.generate).toHaveBeenCalledTimes(1);
      expect(result.statusCode).toBe(201);
    });

    it('READY with changed inputs but the daily cap used: the stored tip stands', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.READY, content: tip, inputHash: 'old', generation: 2 }),
      );

      const result = await service.generate('child-1', caller, now);

      expect(result.statusCode).toBe(200);
      expect(prisma.aiOutput.updateMany).not.toHaveBeenCalled();
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('fresh PENDING: 202 and no provider call', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(row({ updatedAt: new Date(now.getTime() - 1000) }));

      const result = await service.generate('child-1', caller, now);

      expect(result).toMatchObject({ statusCode: 202, body: { status: 'PENDING' } });
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('stale PENDING (its job died) is taken over as a new generation', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ updatedAt: new Date(now.getTime() - 20 * 60_000) }),
      );
      prisma.aiOutput.updateMany.mockResolvedValue({ count: 1 });
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(
        row({ generation: 2, status: AiOutputStatus.READY, content: tip }),
      );

      await service.generate('child-1', caller, now);

      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ generation: 2 }) }),
      );
      expect(generator.generate).toHaveBeenCalledTimes(1);
    });

    it('FAILED after provider spend and generation 1: one more try; at the cap: 200 UNAVAILABLE', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.FAILED, failureReason: 'BLOCKED', generation: 2 }),
      );

      const result = await service.generate('child-1', caller, now);

      expect(result).toMatchObject({
        statusCode: 200,
        body: { status: 'UNAVAILABLE', reason: 'BLOCKED', tip: null },
      });
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('FAILED for CAPACITY retries without using up a generation', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.FAILED, failureReason: 'CAPACITY', generation: 2 }),
      );
      prisma.aiOutput.updateMany.mockResolvedValue({ count: 1 });
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(
        row({ generation: 2, status: AiOutputStatus.READY, content: tip }),
      );

      await service.generate('child-1', caller, now);

      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ generation: 2 }) }),
      );
      expect(generator.generate).toHaveBeenCalledTimes(1);
    });

    it('losing the claim race returns the existing state without calling the provider', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.FAILED, failureReason: 'PROVIDER' }),
      );
      prisma.aiOutput.updateMany.mockResolvedValue({ count: 0 });
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(row({ generation: 2 }));

      const result = await service.generate('child-1', caller, now);

      expect(result.statusCode).toBe(202);
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('applies the per-user daily limit to a regeneration too', async () => {
      const { service, prisma, budget } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(
        row({ status: AiOutputStatus.FAILED, failureReason: 'PROVIDER' }),
      );
      budget.generationsByUserToday.mockResolvedValue(3);

      await expect(service.generate('child-1', caller, now)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(prisma.aiOutput.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    it('RETRYABLE: enqueues the job in a transaction (outbox), kicks after, answers 202', async () => {
      const { service, prisma, generator, queue } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      prisma.aiOutput.create.mockResolvedValue(row());
      generator.generate.mockResolvedValue({
        kind: 'RETRYABLE',
        reason: 'PROVIDER',
        error: new AiRunError('AI_PROVIDER', { retryable: true, httpStatus: 503 }),
      });

      const result = await service.generate('child-1', caller, now);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(queue.enqueue).toHaveBeenCalledWith(
        { tx: true },
        {
          type: 'ai.coaching-tip.generate',
          payload: { outputId: 'out-1' },
          dedupeKey: 'ai.coaching-tip:out-1:1',
          maxAttempts: 3,
        },
      );
      expect(queue.kick).toHaveBeenCalledTimes(1);
      expect(queue.kick.mock.invocationCallOrder[0]).toBeGreaterThan(
        queue.enqueue.mock.invocationCallOrder[0],
      );
      expect(result).toMatchObject({ statusCode: 202, body: { status: 'PENDING' } });
    });

    it('FAILED outcome: 200 UNAVAILABLE with the stored reason', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      prisma.aiOutput.create.mockResolvedValue(row());
      generator.generate.mockResolvedValue({ kind: 'FAILED', reason: 'CAPACITY' });
      prisma.aiOutput.findUniqueOrThrow.mockResolvedValue(
        row({ status: AiOutputStatus.FAILED, failureReason: 'CAPACITY' }),
      );

      const result = await service.generate('child-1', caller, now);

      expect(result).toMatchObject({
        statusCode: 200,
        body: { status: 'UNAVAILABLE', reason: 'CAPACITY', tip: null },
      });
    });

    it('an unexpected error marks the row FAILED (not left PENDING) and is rethrown', async () => {
      const { service, prisma, generator } = make();
      prisma.aiOutput.findUnique.mockResolvedValue(null);
      const claimed = row();
      prisma.aiOutput.create.mockResolvedValue(claimed);
      generator.generate.mockRejectedValue(new Error('boom'));

      await expect(service.generate('child-1', caller, now)).rejects.toThrow('boom');
      expect(generator.markFailed).toHaveBeenCalledWith(claimed, 'PROVIDER');
    });

    it('propagates authorization/context errors from prepare before touching the table', async () => {
      const { service, prisma, generator } = make();
      generator.prepare.mockRejectedValue(
        new HttpException({ code: 'PLAN_NOT_FOUND' }, HttpStatus.NOT_FOUND),
      );

      await expect(service.generate('child-1', caller, now)).rejects.toMatchObject({ status: 404 });
      expect(prisma.aiOutput.findUnique).not.toHaveBeenCalled();
    });
  });
});

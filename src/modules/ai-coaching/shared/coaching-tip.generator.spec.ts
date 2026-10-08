import { HttpException, HttpStatus } from '@nestjs/common';
import { AiOutputStatus, Role, UserStatus } from '@prisma/client';
import { AiRunError, type AiRunErrorCode } from '@common/ai/ai.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CoachingTipGenerator } from './coaching-tip.generator';
import { coachingTipPrompt } from './coaching-tip.request';

const caller: AuthenticatedUser = {
  id: 'parent-1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const tip = { headline: 'A calm start', body: 'Dim the lights.', tryThis: ['Dim the lights.'] };
const context = {
  ageYears: 6,
  planDay: { dayNumber: 3, title: 'Bedtime', instructions: 'Dim the lights.' },
  lastWeek: { daysLogged: 2, sleepMinutesAverage: null },
  clinicianTips: [],
};

function make() {
  const prisma = { aiOutput: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const ai = {
    generateStructured: jest.fn().mockResolvedValue({
      output: tip,
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      attempt: 1,
    }),
  };
  const access = { assertCanGenerate: jest.fn().mockResolvedValue({ id: 'child-1', name: 'Alex' }) };
  const built = { context, nameTokens: ['Alex'], inputHash: jest.fn().mockReturnValue('hash-1') };
  const builder = { build: jest.fn().mockResolvedValue(built) };
  const config = { get: () => ({ maxOutputTokens: 700 }) };
  const generator = new CoachingTipGenerator(
    prisma as never,
    ai as never,
    access as never,
    builder as never,
    config as never,
  );
  const prepared = { child: { id: 'child-1' }, built } as never;
  return { generator, prisma, ai, access, builder, built, prepared };
}

describe('CoachingTipGenerator', () => {
  describe('prepare', () => {
    it('authorises as the caller, then builds the minimised context', async () => {
      const { generator, access, builder, built } = make();
      const now = new Date('2026-10-05T10:00:00Z');

      const prepared = await generator.prepare('child-1', caller, now);

      expect(access.assertCanGenerate).toHaveBeenCalledWith('child-1', caller);
      expect(builder.build).toHaveBeenCalledWith({ id: 'child-1', name: 'Alex' }, caller, now);
      expect(prepared.built).toBe(built);
    });

    it('does not build a context for a caller who is refused', async () => {
      const { generator, access, builder } = make();
      access.assertCanGenerate.mockRejectedValue(new HttpException('no', 403));

      await expect(generator.prepare('child-1', caller)).rejects.toMatchObject({ status: 403 });
      expect(builder.build).not.toHaveBeenCalled();
    });
  });

  describe('reasonForHttpError', () => {
    it.each([
      [{ code: 'AI_DISABLED' }, 'DISABLED'],
      [{ code: 'PLAN_NOT_FOUND' }, 'NO_PLAN'],
      [{ code: 'FORBIDDEN' }, 'ACCESS'],
      ['plain string body', 'ACCESS'],
    ])('maps %j to %s', (body, reason) => {
      expect(
        CoachingTipGenerator.reasonForHttpError(new HttpException(body, HttpStatus.BAD_REQUEST)),
      ).toBe(reason);
    });
  });

  describe('generate', () => {
    it('sends the versioned prompt, the schema and the actor, with the configured output cap', async () => {
      const { generator, ai, prepared } = make();

      await generator.generate({ id: 'out-1', content: null }, prepared, caller);

      const req = ai.generateStructured.mock.calls[0][0];
      expect(req).toMatchObject({
        capability: 'coaching-tip',
        prompt: { id: 'coaching-tip', version: coachingTipPrompt.version },
        system: coachingTipPrompt.system,
        user: coachingTipPrompt.buildUser(context),
        actor: { userId: 'parent-1', childId: 'child-1' },
        maxOutputTokens: 700,
      });
      expect(JSON.stringify(req.user)).not.toContain('Alex');
    });

    it("wires the safety filter with the child's name tokens as the post-check", async () => {
      const { generator, ai, prepared } = make();
      await generator.generate({ id: 'out-1', content: null }, prepared, caller);
      const { postCheck } = ai.generateStructured.mock.calls[0][0];

      expect(postCheck(tip)).toBe('ok');
      expect(postCheck({ ...tip, body: 'Well done, Alex!' })).toEqual({ reject: 'NAME_LEAK' });
      expect(postCheck({ ...tip, body: 'Ask about the medication.' })).toEqual({
        reject: 'MEDICATION',
      });
    });

    it('stores the validated tip with the model that produced it, fenced on PENDING', async () => {
      const { generator, prisma, prepared } = make();

      await expect(
        generator.generate({ id: 'out-1', content: null }, prepared, caller),
      ).resolves.toEqual({ kind: 'READY' });

      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith({
        where: { id: 'out-1', status: AiOutputStatus.PENDING },
        data: {
          status: AiOutputStatus.READY,
          content: tip,
          provider: 'google',
          model: 'gemini-3.5-flash-lite',
          inputHash: 'hash-1',
          promptVersion: coachingTipPrompt.version,
          failureReason: null,
        },
      });
    });

    it('SKIPPED when the row was no longer PENDING', async () => {
      const { generator, prisma, prepared } = make();
      prisma.aiOutput.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        generator.generate({ id: 'out-1', content: null }, prepared, caller),
      ).resolves.toEqual({ kind: 'SKIPPED' });
    });

    it.each<[AiRunErrorCode, string]>([
      ['AI_BUDGET', 'CAPACITY'],
      ['AI_BLOCKED', 'BLOCKED'],
      ['AI_INVALID_OUTPUT', 'BLOCKED'],
      ['AI_PROVIDER', 'PROVIDER'],
      ['AI_DISABLED', 'DISABLED'],
    ])('a non-retryable %s fails the row with reason %s', async (code, reason) => {
      const { generator, ai, prisma, prepared } = make();
      ai.generateStructured.mockRejectedValue(new AiRunError(code));

      await expect(
        generator.generate({ id: 'out-1', content: null }, prepared, caller),
      ).resolves.toEqual({ kind: 'FAILED', reason });

      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith({
        where: { id: 'out-1', status: AiOutputStatus.PENDING },
        data: { status: AiOutputStatus.FAILED, failureReason: reason },
      });
    });

    it('a retryable failure leaves the row untouched and hands the decision to the caller', async () => {
      const { generator, ai, prisma, prepared } = make();
      const error = new AiRunError('AI_TIMEOUT', { retryable: true });
      ai.generateStructured.mockRejectedValue(error);

      await expect(
        generator.generate({ id: 'out-1', content: null }, prepared, caller),
      ).resolves.toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER', error });
      expect(prisma.aiOutput.updateMany).not.toHaveBeenCalled();
    });

    it('rethrows anything that is not an AiRunError', async () => {
      const { generator, ai, prepared } = make();
      ai.generateStructured.mockRejectedValue(new TypeError('bug'));

      await expect(
        generator.generate({ id: 'out-1', content: null }, prepared, caller),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('markFailed', () => {
    it('FAILED when there is no earlier tip', async () => {
      const { generator, prisma } = make();
      await generator.markFailed({ id: 'out-1', content: null }, 'BLOCKED');
      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith({
        where: { id: 'out-1', status: AiOutputStatus.PENDING },
        data: { status: AiOutputStatus.FAILED, failureReason: 'BLOCKED' },
      });
    });

    it('restores the earlier validated tip when a regeneration fails', async () => {
      const { generator, prisma } = make();
      await generator.markFailed({ id: 'out-1', content: tip }, 'PROVIDER');
      expect(prisma.aiOutput.updateMany).toHaveBeenCalledWith({
        where: { id: 'out-1', status: AiOutputStatus.PENDING },
        data: { status: AiOutputStatus.READY, failureReason: 'PROVIDER' },
      });
    });
  });
});

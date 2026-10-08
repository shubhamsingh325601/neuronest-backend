import { ForbiddenException } from '@nestjs/common';
import { AiOutputStatus, Role, UserStatus, type AiOutput } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { GetCoachingTipService } from './get-coaching-tip.service';

const now = new Date('2026-10-05T10:00:00Z');
const caller: AuthenticatedUser = {
  id: 'parent-1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const tip = { headline: 'A calm start', body: 'Dim the lights.', tryThis: ['Dim the lights.'] };

const row = (overrides: Partial<AiOutput> = {}): AiOutput => ({
  id: 'out-1',
  childId: 'child-1',
  capability: 'coaching-tip',
  forDate: new Date('2026-10-05T00:00:00Z'),
  status: AiOutputStatus.READY,
  generation: 1,
  inputHash: 'h',
  promptVersion: 1,
  provider: 'google',
  model: 'gemini-3.5-flash-lite',
  content: tip,
  failureReason: null,
  requestedById: 'parent-1',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

function make(enabled = true) {
  const prisma = { aiOutput: { findUnique: jest.fn() } };
  const access = { enabled, getChildForRead: jest.fn().mockResolvedValue({ id: 'child-1' }) };
  return { service: new GetCoachingTipService(prisma as never, access as never), prisma, access };
}

describe('GetCoachingTipService', () => {
  it('NONE when nothing was generated today, and queries today (UTC) for the child', async () => {
    const { service, prisma } = make();
    prisma.aiOutput.findUnique.mockResolvedValue(null);

    await expect(service.getToday('child-1', caller, now)).resolves.toEqual({
      status: 'NONE',
      tip: null,
      aiGenerated: true,
      disclaimer: expect.stringContaining('not medical advice'),
      forDate: '2026-10-05',
    });
    expect(prisma.aiOutput.findUnique).toHaveBeenCalledWith({
      where: {
        childId_capability_forDate: {
          childId: 'child-1',
          capability: 'coaching-tip',
          forDate: new Date('2026-10-05T00:00:00Z'),
        },
      },
    });
  });

  it('READY returns the tip and generatedAt, and never the prompt version, provider or model', async () => {
    const { service, prisma } = make();
    prisma.aiOutput.findUnique.mockResolvedValue(row());

    const body = await service.getToday('child-1', caller, now);

    expect(body).toMatchObject({ status: 'READY', tip, generatedAt: now, aiGenerated: true });
    const json = JSON.stringify(body);
    expect(json).not.toContain('gemini');
    expect(json).not.toContain('google');
    expect(json).not.toContain('promptVersion');
  });

  it('PENDING is pending while fresh and UNAVAILABLE once abandoned', async () => {
    const { service, prisma } = make();
    prisma.aiOutput.findUnique.mockResolvedValue(
      row({ status: AiOutputStatus.PENDING, content: null }),
    );
    await expect(service.getToday('child-1', caller, now)).resolves.toMatchObject({
      status: 'PENDING',
    });

    prisma.aiOutput.findUnique.mockResolvedValue(
      row({
        status: AiOutputStatus.PENDING,
        content: null,
        updatedAt: new Date(now.getTime() - 16 * 60_000),
      }),
    );
    await expect(service.getToday('child-1', caller, now)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'PROVIDER',
    });
  });

  it.each([
    ['CAPACITY', 'CAPACITY'],
    ['BLOCKED', 'BLOCKED'],
    ['DISABLED', 'DISABLED'],
    ['PROVIDER', 'PROVIDER'],
    ['NO_PLAN', 'PROVIDER'],
    ['ACCESS', 'PROVIDER'],
    [null, 'PROVIDER'],
  ])('FAILED (%s) is UNAVAILABLE with public reason %s', async (stored, reason) => {
    const { service, prisma } = make();
    prisma.aiOutput.findUnique.mockResolvedValue(
      row({ status: AiOutputStatus.FAILED, content: null, failureReason: stored }),
    );

    await expect(service.getToday('child-1', caller, now)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason,
      tip: null,
    });
  });

  it('a READY row with unparseable content is UNAVAILABLE, never raw JSON', async () => {
    const { service, prisma } = make();
    prisma.aiOutput.findUnique.mockResolvedValue(row({ content: { unexpected: true } }));

    await expect(service.getToday('child-1', caller, now)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      tip: null,
    });
  });

  it('AI disabled: UNAVAILABLE/DISABLED without touching the table', async () => {
    const { service, prisma } = make(false);

    await expect(service.getToday('child-1', caller, now)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'DISABLED',
    });
    expect(prisma.aiOutput.findUnique).not.toHaveBeenCalled();
  });

  it('checks access first, with the real caller, and surfaces its error', async () => {
    const { service, prisma, access } = make();
    access.getChildForRead.mockRejectedValue(new ForbiddenException());

    await expect(service.getToday('child-1', caller, now)).rejects.toThrow(ForbiddenException);
    expect(access.getChildForRead).toHaveBeenCalledWith('child-1', caller);
    expect(prisma.aiOutput.findUnique).not.toHaveBeenCalled();
  });
});

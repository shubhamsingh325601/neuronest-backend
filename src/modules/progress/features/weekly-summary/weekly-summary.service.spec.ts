import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { WeeklySummaryService } from './weekly-summary.service';

describe('WeeklySummaryService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    progressEntry: { findMany: jest.fn() },
    plan: { findFirst: jest.fn() },
  };
  let service: WeeklySummaryService;
  // Sunday 2026-10-04 -> previous full week is Mon 2026-09-21 .. Sun 2026-09-27.
  const now = new Date('2026-10-04T10:00:00Z');
  const parent: AuthenticatedUser = {
    id: 'parent-1',
    email: 'p@example.com',
    role: Role.PARENT,
    status: UserStatus.ACTIVE,
  };
  const e = (day: string, mood: number | null, behaviour: number | null, sleep: number | null) => ({
    entryDate: new Date(`${day}T00:00:00Z`),
    mood,
    behaviour,
    sleepMinutes: sleep,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.progressEntry.findMany.mockResolvedValue([]);
    prisma.plan.findFirst.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [WeeklySummaryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(WeeklySummaryService);
  });

  it('403s for a parent who does not own the child', async () => {
    await expect(
      service.summarise('child-1', { ...parent, id: 'other' }, {}, now),
    ).rejects.toThrow(ForbiddenException);
  });

  it('an empty week is zeros/nulls with no plan, not an error', async () => {
    const result = await service.summarise('child-1', parent, {}, now);
    expect(result).toMatchObject({
      weekStart: '2026-09-21',
      weekEnd: '2026-09-27',
      daysLogged: 0,
      trend: null,
      activePlan: null,
      mood: { average: null, min: null, max: null },
    });
  });

  it('defaults to the previous full week and queries it together with the prior week', async () => {
    await service.summarise('child-1', parent, {}, now);
    expect(prisma.progressEntry.findMany.mock.calls[0][0].where.entryDate).toEqual({
      gte: new Date('2026-09-14T00:00:00Z'),
      lte: new Date('2026-09-27T00:00:00Z'),
    });
  });

  it('normalises weekStart to its Monday and computes aggregates + trend vs the prior week', async () => {
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1', planTemplate: { title: 'Speech' } });
    prisma.progressEntry.findMany.mockResolvedValue([
      e('2026-09-14', 2, 2, 400), // prior week
      e('2026-09-21', 4, 4, 480), // requested week
      e('2026-09-23', 5, 3, 540),
    ]);
    const result = await service.summarise('child-1', parent, { weekStart: '2026-09-23' }, now);
    expect(result.weekStart).toBe('2026-09-21');
    expect(result.daysLogged).toBe(2);
    expect(result.mood).toEqual({ average: 4.5, min: 4, max: 5 });
    expect(result.behaviour).toEqual({ average: 3.5, min: 3, max: 4 });
    expect(result.sleepMinutes).toEqual({ average: 510, min: 480, max: 540 });
    expect(result.trend).toBe('UP');
    expect(result.activePlan).toEqual({ id: 'plan-1', title: 'Speech' });
  });
});

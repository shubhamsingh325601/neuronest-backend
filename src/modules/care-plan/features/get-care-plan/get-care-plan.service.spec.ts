import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetCarePlanService } from './get-care-plan.service';

const week = (weekNumber: number) => ({
  id: `w${weekNumber}`,
  weekNumber,
  title: `Week ${weekNumber}`,
  focus: 'Focus',
  guidance: null,
  goals: [],
  activities: [],
});

describe('GetCarePlanService', () => {
  const child = { findUnique: jest.fn() };
  const plan = { findFirst: jest.fn() };
  const clinicianChildAssignment = { findFirst: jest.fn(), findUnique: jest.fn() };
  let service: GetCarePlanService;
  const parent = { id: 'p1', role: Role.PARENT } as never;

  beforeEach(async () => {
    jest.resetAllMocks();
    child.findUnique.mockResolvedValue({ id: 'c1', parentId: 'p1' });
    clinicianChildAssignment.findFirst.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetCarePlanService,
        { provide: PrismaService, useValue: { child, plan, clinicianChildAssignment } },
      ],
    }).compile();
    service = moduleRef.get(GetCarePlanService);
  });

  it('404s without an active plan', async () => {
    plan.findFirst.mockResolvedValue(null);
    await expect(service.get('c1', parent)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('computes the current week and day from the start date', async () => {
    plan.findFirst.mockResolvedValue({
      id: 'plan1',
      startDate: new Date('2026-10-01T00:00:00Z'),
      createdAt: new Date(),
      weeks: [week(1), week(2), week(3), week(4)],
    });
    // Oct 9 = day 9 => week 2, day 2.
    const res = await service.get('c1', parent, new Date('2026-10-09T10:00:00Z'));
    expect(res).toMatchObject({ currentWeek: 2, currentDayOfWeek: 2, totalWeeks: 4 });
    expect(res.weeks.map((w) => w.status)).toEqual([
      'completed',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('uses the caller’s local calendar day when an offset is given', async () => {
    plan.findFirst.mockResolvedValue({
      id: 'plan1',
      startDate: new Date('2026-10-01T00:00:00Z'),
      createdAt: new Date(),
      weeks: [week(1), week(2), week(3), week(4)],
    });
    // 20:00 UTC on Oct 14 is 01:30 on Oct 15 in India (UTC+5:30): day 15 => week 3, day 1.
    const now = new Date('2026-10-14T20:00:00Z');
    expect(await service.get('c1', parent, now)).toMatchObject({ currentWeek: 2, currentDayOfWeek: 7 });
    expect(await service.get('c1', parent, now, 330)).toMatchObject({
      currentWeek: 3,
      currentDayOfWeek: 1,
    });
  });

  it('clamps to the last week once the plan has run out', async () => {
    plan.findFirst.mockResolvedValue({
      id: 'plan1',
      startDate: new Date('2026-09-01T00:00:00Z'),
      createdAt: new Date(),
      weeks: [week(1), week(2)],
    });
    const res = await service.get('c1', parent, new Date('2026-10-09T10:00:00Z'));
    expect(res).toMatchObject({ currentWeek: 2, currentDayOfWeek: 7 });
  });

  it('shows week 1 day 1 before the plan starts', async () => {
    plan.findFirst.mockResolvedValue({
      id: 'plan1',
      startDate: new Date('2026-10-20T00:00:00Z'),
      createdAt: new Date(),
      weeks: [week(1)],
    });
    const res = await service.get('c1', parent, new Date('2026-10-09T10:00:00Z'));
    expect(res).toMatchObject({ currentWeek: 1, currentDayOfWeek: 1 });
  });
});

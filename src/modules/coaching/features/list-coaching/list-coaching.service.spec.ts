import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListCoachingService } from './list-coaching.service';

describe('ListCoachingService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    plan: { findFirst: jest.fn() },
    coachingTip: { findMany: jest.fn() },
  };
  let service: ListCoachingService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const tip = {
    id: 't-1',
    childId: 'child-1',
    planId: 'plan-1',
    weekNumber: 1,
    position: 1,
    title: 'T',
    body: 'B',
    authorId: 'author-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.coachingTip.findMany.mockResolvedValue([tip]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListCoachingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListCoachingService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('x', asUser('admin-1', Role.ADMIN), {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403s for another parent and an unassigned clinician', async () => {
    await expect(service.list('child-1', asUser('other', Role.PARENT), {})).rejects.toThrow(
      ForbiddenException,
    );
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', asUser('cl-1', Role.CLINICIAN), {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns an empty list when the child has no active plan', async () => {
    prisma.plan.findFirst.mockResolvedValue(null);
    const res = await service.list('child-1', asUser('parent-1', Role.PARENT), {});
    expect(res).toEqual({ weekNumber: null, tips: [] });
  });

  it('resolves week=current from the plan start date and redacts authorId for a parent', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 8); // day 9 → week 2
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1', startDate: start });
    const res = await service.list('child-1', asUser('parent-1', Role.PARENT), {});
    expect(prisma.coachingTip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { planId: 'plan-1', weekNumber: 2 } }),
    );
    expect(res.tips[0]).not.toHaveProperty('authorId');
  });

  it('returns an empty current week before the plan starts', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 5);
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1', startDate: start });
    const res = await service.list('child-1', asUser('parent-1', Role.PARENT), {});
    expect(res).toEqual({ weekNumber: null, tips: [] });
    expect(prisma.coachingTip.findMany).not.toHaveBeenCalled();
  });

  it('reads an explicit week and exposes authorId to staff', async () => {
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1', startDate: new Date() });
    const res = await service.list('child-1', asUser('admin-1', Role.ADMIN), { week: '3' });
    expect(prisma.coachingTip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { planId: 'plan-1', weekNumber: 3 } }),
    );
    expect(res.tips[0].authorId).toBe('author-1');
  });
});

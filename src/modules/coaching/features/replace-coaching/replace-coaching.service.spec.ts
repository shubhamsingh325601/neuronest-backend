import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ReplaceCoachingService } from './replace-coaching.service';

describe('ReplaceCoachingService', () => {
  const tx = {
    coachingTip: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  };
  const prisma = {
    plan: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: ReplaceCoachingService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', childId: 'child-1' });
    tx.coachingTip.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [ReplaceCoachingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ReplaceCoachingService);
  });

  it('404s when the plan does not exist', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(
      service.replace('x', 1, asUser('admin-1', Role.ADMIN), { tips: [] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('403s for an unassigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.replace('plan-1', 1, asUser('cl-1', Role.CLINICIAN), { tips: [] }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes then inserts positions 1..n for an assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a-1' });
    await service.replace('plan-1', 2, asUser('cl-1', Role.CLINICIAN), {
      tips: [
        { title: 'A', body: 'a' },
        { title: 'B', body: 'b' },
      ],
    });
    expect(tx.coachingTip.deleteMany).toHaveBeenCalledWith({
      where: { planId: 'plan-1', weekNumber: 2 },
    });
    expect(tx.coachingTip.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ position: 1, title: 'A', authorId: 'cl-1', childId: 'child-1' }),
        expect.objectContaining({ position: 2, title: 'B', authorId: 'cl-1', childId: 'child-1' }),
      ],
    });
  });

  it('an empty tips array only clears the week', async () => {
    await service.replace('plan-1', 1, asUser('admin-1', Role.ADMIN), { tips: [] });
    expect(tx.coachingTip.deleteMany).toHaveBeenCalled();
    expect(tx.coachingTip.createMany).not.toHaveBeenCalled();
  });
});

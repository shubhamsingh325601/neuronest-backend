import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CompletePlanService } from './complete-plan.service';

describe('CompletePlanService', () => {
  const prisma = {
    plan: { findUnique: jest.fn(), update: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
  };
  let service: CompletePlanService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const activePlan = {
    id: 'plan-1',
    childId: 'child-1',
    planTemplateId: 'template-1',
    status: 'ACTIVE',
    origin: 'MANUAL',
    startDate: new Date('2026-09-22'),
    createdById: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CompletePlanService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CompletePlanService);
  });

  it('404s a missing plan', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(service.complete('missing', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.plan.findUnique.mockResolvedValue(activePlan);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.complete('plan-1', asUser('clinician-1', Role.CLINICIAN)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('completes an ACTIVE plan for admin', async () => {
    prisma.plan.findUnique.mockResolvedValue(activePlan);
    prisma.plan.update.mockResolvedValue({ ...activePlan, status: 'COMPLETED' });
    const result = await service.complete('plan-1', asUser('admin-1', Role.ADMIN));
    expect(result.status).toBe('COMPLETED');
  });

  it('is idempotent when already COMPLETED', async () => {
    prisma.plan.findUnique.mockResolvedValue({ ...activePlan, status: 'COMPLETED' });
    const result = await service.complete('plan-1', asUser('admin-1', Role.ADMIN));
    expect(result.status).toBe('COMPLETED');
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('409s completing an ARCHIVED plan', async () => {
    prisma.plan.findUnique.mockResolvedValue({ ...activePlan, status: 'ARCHIVED' });
    await expect(service.complete('plan-1', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      ConflictException,
    );
  });
});

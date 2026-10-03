import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlanStatus, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetPlanService } from './get-plan.service';

describe('GetPlanService', () => {
  const prisma = {
    plan: { findUnique: jest.fn() },
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
  };
  let service: GetPlanService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const planRow = {
    id: 'plan-1',
    childId: 'child-1',
    planTemplateId: 'template-1',
    status: PlanStatus.COMPLETED,
    origin: 'MANUAL',
    startDate: new Date('2026-01-01'),
    createdById: 'clinician-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetPlanService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetPlanService);
  });

  it('404s when the plan does not exist', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(service.getById('missing', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allows the owning parent, even for a COMPLETED plan', async () => {
    prisma.plan.findUnique.mockResolvedValue(planRow);
    prisma.child.findUnique.mockResolvedValue({ parentId: 'parent-1' });

    const result = await service.getById('plan-1', asUser('parent-1', Role.PARENT));
    expect(result.id).toBe('plan-1');
    expect(result.status).toBe(PlanStatus.COMPLETED);
  });

  it('forbids a different parent', async () => {
    prisma.plan.findUnique.mockResolvedValue(planRow);
    prisma.child.findUnique.mockResolvedValue({ parentId: 'parent-1' });
    await expect(service.getById('plan-1', asUser('parent-2', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an assigned clinician', async () => {
    prisma.plan.findUnique.mockResolvedValue(planRow);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });

    const result = await service.getById('plan-1', asUser('clinician-1', Role.CLINICIAN));
    expect(result.id).toBe('plan-1');
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.plan.findUnique.mockResolvedValue(planRow);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.getById('plan-1', asUser('clinician-2', Role.CLINICIAN))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows admin unconditionally', async () => {
    prisma.plan.findUnique.mockResolvedValue(planRow);
    const result = await service.getById('plan-1', asUser('admin-1', Role.ADMIN));
    expect(result.id).toBe('plan-1');
  });
});

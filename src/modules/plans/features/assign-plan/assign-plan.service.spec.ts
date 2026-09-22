import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AssignPlanService } from './assign-plan.service';

describe('AssignPlanService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    planTemplate: { findUnique: jest.fn() },
    plan: { findFirst: jest.fn(), create: jest.fn() },
  };
  let service: AssignPlanService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const dto = { planTemplateId: 'template-1', startDate: '2026-09-22' };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.planTemplate.findUnique.mockResolvedValue({ id: 'template-1', status: 'PUBLISHED' });
    prisma.plan.findFirst.mockResolvedValue(null);
    prisma.plan.create.mockResolvedValue({
      id: 'plan-1',
      childId: 'child-1',
      planTemplateId: 'template-1',
      status: 'ACTIVE',
      origin: 'MANUAL',
      startDate: new Date('2026-09-22'),
      createdById: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [AssignPlanService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AssignPlanService);
  });

  it('404s a missing child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.assign('child-1', asUser('admin-1', Role.ADMIN), dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.assign('child-1', asUser('clinician-1', Role.CLINICIAN), dto),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    const result = await service.assign('child-1', asUser('clinician-1', Role.CLINICIAN), dto);
    expect(result.id).toBe('plan-1');
  });

  it('404s a missing template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(null);
    await expect(service.assign('child-1', asUser('admin-1', Role.ADMIN), dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s an unpublished template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue({ id: 'template-1', status: 'DRAFT' });
    await expect(service.assign('child-1', asUser('admin-1', Role.ADMIN), dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when the child already has an active plan', async () => {
    prisma.plan.findFirst.mockResolvedValue({ id: 'existing-plan' });
    await expect(service.assign('child-1', asUser('admin-1', Role.ADMIN), dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('creates the plan for admin unconditionally', async () => {
    const result = await service.assign('child-1', asUser('admin-1', Role.ADMIN), dto);
    expect(result.status).toBe('ACTIVE');
    expect(prisma.plan.create).toHaveBeenCalledWith({
      data: {
        childId: 'child-1',
        planTemplateId: 'template-1',
        startDate: new Date('2026-09-22'),
        createdById: 'admin-1',
      },
    });
  });
});

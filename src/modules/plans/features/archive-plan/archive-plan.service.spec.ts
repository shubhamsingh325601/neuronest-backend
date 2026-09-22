import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ArchivePlanService } from './archive-plan.service';

describe('ArchivePlanService', () => {
  const prisma = {
    plan: { findUnique: jest.fn(), update: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
  };
  let service: ArchivePlanService;

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
      providers: [ArchivePlanService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ArchivePlanService);
  });

  it('404s a missing plan', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(service.archive('missing', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.plan.findUnique.mockResolvedValue(activePlan);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.archive('plan-1', asUser('clinician-1', Role.CLINICIAN))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('archives an ACTIVE plan for admin', async () => {
    prisma.plan.findUnique.mockResolvedValue(activePlan);
    prisma.plan.update.mockResolvedValue({ ...activePlan, status: 'ARCHIVED' });
    const result = await service.archive('plan-1', asUser('admin-1', Role.ADMIN));
    expect(result.status).toBe('ARCHIVED');
  });

  it('is idempotent when already ARCHIVED', async () => {
    prisma.plan.findUnique.mockResolvedValue({ ...activePlan, status: 'ARCHIVED' });
    const result = await service.archive('plan-1', asUser('admin-1', Role.ADMIN));
    expect(result.status).toBe('ARCHIVED');
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('409s archiving a COMPLETED plan', async () => {
    prisma.plan.findUnique.mockResolvedValue({ ...activePlan, status: 'COMPLETED' });
    await expect(service.archive('plan-1', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      ConflictException,
    );
  });
});

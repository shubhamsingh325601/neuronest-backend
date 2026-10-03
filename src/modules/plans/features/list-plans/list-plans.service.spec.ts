import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlanStatus, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListPlansService } from './list-plans.service';

describe('ListPlansService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    plan: { findMany: jest.fn() },
  };
  let service: ListPlansService;

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
    status: PlanStatus.ACTIVE,
    origin: 'MANUAL',
    startDate: new Date('2026-01-01'),
    createdById: 'clinician-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListPlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListPlansService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('missing', asUser('admin-1', Role.ADMIN), {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a different parent', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    await expect(service.list('child-1', asUser('parent-2', Role.PARENT), {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('child-1', asUser('clinician-2', Role.CLINICIAN), {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns a page for the owning parent, including a COMPLETED/ARCHIVED plan history', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.plan.findMany.mockResolvedValue([
      { ...planRow, id: 'plan-2', status: PlanStatus.COMPLETED },
      planRow,
    ]);

    const result = await service.list('child-1', asUser('parent-1', Role.PARENT), {});

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('applies an optional ?status= filter', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.plan.findMany.mockResolvedValue([planRow]);

    await service.list('child-1', asUser('parent-1', Role.PARENT), { status: PlanStatus.ACTIVE });

    expect(prisma.plan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { childId: 'child-1', status: PlanStatus.ACTIVE } }),
    );
  });

  it('allows an assigned clinician and admin unconditionally', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.plan.findMany.mockResolvedValue([]);

    await expect(
      service.list('child-1', asUser('clinician-1', Role.CLINICIAN), {}),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(service.list('child-1', asUser('admin-1', Role.ADMIN), {})).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
  });
});

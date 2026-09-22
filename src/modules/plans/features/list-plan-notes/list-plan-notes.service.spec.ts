import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListPlanNotesService } from './list-plan-notes.service';

describe('ListPlanNotesService', () => {
  const prisma = {
    plan: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    planNote: { findMany: jest.fn() },
  };
  let service: ListPlanNotesService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', childId: 'child-1' });
    prisma.planNote.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListPlanNotesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListPlanNotesService);
  });

  it('404s a missing plan', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(service.list('missing', asUser('admin-1', Role.ADMIN), {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('plan-1', asUser('clinician-1', Role.CLINICIAN), {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sorts oldest-first', async () => {
    await service.list('plan-1', asUser('admin-1', Role.ADMIN), {});
    expect(prisma.planNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });
});

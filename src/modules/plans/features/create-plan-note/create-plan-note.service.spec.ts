import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CreatePlanNoteService } from './create-plan-note.service';

describe('CreatePlanNoteService', () => {
  const prisma = {
    plan: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    planNote: { create: jest.fn() },
  };
  let service: CreatePlanNoteService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', childId: 'child-1' });
    prisma.planNote.create.mockResolvedValue({
      id: 'note-1',
      planId: 'plan-1',
      authorId: 'clinician-1',
      note: 'looks good',
      createdAt: new Date(),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [CreatePlanNoteService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CreatePlanNoteService);
  });

  it('404s a missing plan', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing', asUser('admin-1', Role.ADMIN), { note: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.create('plan-1', asUser('clinician-1', Role.CLINICIAN), { note: 'x' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an assigned clinician to leave a note', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    const result = await service.create('plan-1', asUser('clinician-1', Role.CLINICIAN), {
      note: 'looks good',
    });
    expect(result.note).toBe('looks good');
  });

  it('allows admin unconditionally', async () => {
    const result = await service.create('plan-1', asUser('admin-1', Role.ADMIN), {
      note: 'looks good',
    });
    expect(result.id).toBe('note-1');
  });
});

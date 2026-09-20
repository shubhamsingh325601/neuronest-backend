import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { AssignClinicianService } from './assign-clinician.service';

describe('AssignClinicianService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn(), create: jest.fn() },
  };
  let service: AssignClinicianService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AssignClinicianService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AssignClinicianService);
  });

  it('creates the assignment', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'clinician-1', role: Role.CLINICIAN });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    prisma.clinicianChildAssignment.create.mockResolvedValue({
      id: 'assign-1',
      clinicianId: 'clinician-1',
      childId: 'child-1',
      assignedByAdminId: 'admin-1',
      createdAt: new Date(),
    });

    const result = await service.assign('child-1', 'admin-1', { clinicianId: 'clinician-1' });

    expect(prisma.clinicianChildAssignment.create).toHaveBeenCalledWith({
      data: { clinicianId: 'clinician-1', childId: 'child-1', assignedByAdminId: 'admin-1' },
    });
    expect(result.id).toBe('assign-1');
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(
      service.assign('missing-child', 'admin-1', { clinicianId: 'clinician-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when the target user is not a clinician', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'parent-1', role: Role.PARENT });
    await expect(
      service.assign('child-1', 'admin-1', { clinicianId: 'parent-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when the clinician id does not exist at all', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.assign('child-1', 'admin-1', { clinicianId: 'nope' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s when already assigned', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'clinician-1', role: Role.CLINICIAN });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.assign('child-1', 'admin-1', { clinicianId: 'clinician-1' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.clinicianChildAssignment.create).not.toHaveBeenCalled();
  });
});

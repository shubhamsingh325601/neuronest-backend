import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { RevokeClinicianAssignmentService } from './revoke-clinician-assignment.service';

describe('RevokeClinicianAssignmentService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { deleteMany: jest.fn() },
  };
  let service: RevokeClinicianAssignmentService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [RevokeClinicianAssignmentService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RevokeClinicianAssignmentService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.revoke('missing', 'clinician-1')).rejects.toThrow(NotFoundException);
    expect(prisma.clinicianChildAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the assignment row when it exists', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.clinicianChildAssignment.deleteMany.mockResolvedValue({ count: 1 });

    await service.revoke('child-1', 'clinician-1');

    expect(prisma.clinicianChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { clinicianId: 'clinician-1', childId: 'child-1' },
    });
  });

  it('is idempotent when the assignment is already gone', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.clinicianChildAssignment.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.revoke('child-1', 'clinician-1')).resolves.toBeUndefined();
  });
});

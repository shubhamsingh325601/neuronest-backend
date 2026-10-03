import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListClinicianAssignmentsService } from './list-clinician-assignments.service';

describe('ListClinicianAssignmentsService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  let service: ListClinicianAssignmentsService;

  const child = { id: 'child-1', parentId: 'parent-1' };
  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListClinicianAssignmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListClinicianAssignmentsService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('missing', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a different parent', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    await expect(service.list('child-1', asUser('parent-2', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', asUser('clinician-2', Role.CLINICIAN))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns the full care team for an assigned clinician, not just their own row', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    const rows = [
      { id: 'a1', clinicianId: 'clinician-1', childId: 'child-1', assignedByAdminId: 'admin-1', createdAt: new Date() },
      { id: 'a2', clinicianId: 'clinician-2', childId: 'child-1', assignedByAdminId: 'admin-1', createdAt: new Date() },
    ];
    prisma.clinicianChildAssignment.findMany.mockResolvedValue(rows);

    const result = await service.list('child-1', asUser('clinician-1', Role.CLINICIAN));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.clinicianId)).toEqual(['clinician-1', 'clinician-2']);
  });

  it('allows the owning parent and admin unconditionally', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    prisma.clinicianChildAssignment.findMany.mockResolvedValue([]);

    await expect(service.list('child-1', asUser('parent-1', Role.PARENT))).resolves.toEqual([]);
    await expect(service.list('child-1', asUser('admin-1', Role.ADMIN))).resolves.toEqual([]);
  });
});

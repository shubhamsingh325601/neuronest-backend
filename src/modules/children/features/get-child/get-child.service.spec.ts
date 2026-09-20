import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { GetChildService } from './get-child.service';

describe('GetChildService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
  };
  let service: GetChildService;

  const child = {
    id: 'child-1',
    parentId: 'parent-1',
    name: 'Alex',
    dateOfBirth: new Date('2019-05-14'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetChildService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetChildService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(
      service.getById('missing', asUser('admin-1', Role.ADMIN)),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows the owning parent', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    const result = await service.getById('child-1', asUser('parent-1', Role.PARENT));
    expect(result.id).toBe('child-1');
  });

  it('forbids a different parent', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    await expect(
      service.getById('child-1', asUser('parent-2', Role.PARENT)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    const result = await service.getById('child-1', asUser('clinician-1', Role.CLINICIAN));
    expect(result.id).toBe('child-1');
    expect(prisma.clinicianChildAssignment.findUnique).toHaveBeenCalledWith({
      where: { clinicianId_childId: { clinicianId: 'clinician-1', childId: 'child-1' } },
      select: { id: true },
    });
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.getById('child-1', asUser('clinician-2', Role.CLINICIAN)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows admin unconditionally', async () => {
    prisma.child.findUnique.mockResolvedValue(child);
    const result = await service.getById('child-1', asUser('admin-1', Role.ADMIN));
    expect(result.id).toBe('child-1');
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetUserService } from './get-user.service';

describe('GetUserService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findMany: jest.fn() },
  };
  let service: GetUserService;

  const baseUser = {
    id: 'u1',
    name: 'Jordan',
    email: 'jordan@example.com',
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetUserService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetUserService);
  });

  it('404s when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
  });

  it('embeds childId for a PARENT with a child', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, role: Role.PARENT });
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

    const result = await service.getById('u1');

    expect(prisma.child.findUnique).toHaveBeenCalledWith({
      where: { parentId: 'u1' },
      select: { id: true },
    });
    expect(result.childId).toBe('child-1');
    expect(result.assignedChildIds).toEqual([]);
  });

  it('gives childId: null for a PARENT with no child yet', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, role: Role.PARENT });
    prisma.child.findUnique.mockResolvedValue(null);

    const result = await service.getById('u1');
    expect(result.childId).toBeNull();
  });

  it('embeds assignedChildIds for a CLINICIAN', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, role: Role.CLINICIAN });
    prisma.clinicianChildAssignment.findMany.mockResolvedValue([
      { childId: 'child-1' },
      { childId: 'child-2' },
    ]);

    const result = await service.getById('u1');

    expect(prisma.clinicianChildAssignment.findMany).toHaveBeenCalledWith({
      where: { clinicianId: 'u1' },
      select: { childId: true },
    });
    expect(result.assignedChildIds).toEqual(['child-1', 'child-2']);
    expect(result.childId).toBeNull();
  });

  it('gives empty relations for an ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, role: Role.ADMIN });

    const result = await service.getById('u1');

    expect(result.childId).toBeNull();
    expect(result.assignedChildIds).toEqual([]);
    expect(prisma.child.findUnique).not.toHaveBeenCalled();
    expect(prisma.clinicianChildAssignment.findMany).not.toHaveBeenCalled();
  });
});

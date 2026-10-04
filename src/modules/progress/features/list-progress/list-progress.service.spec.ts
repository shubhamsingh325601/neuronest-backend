import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { encodeCursor } from '@common/pagination/cursor.util';
import { ListProgressService } from './list-progress.service';

describe('ListProgressService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    progressEntry: { findMany: jest.fn() },
  };
  let service: ListProgressService;
  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const entry = (id: string, day: string) => ({
    id,
    childId: 'child-1',
    planId: null,
    entryDate: new Date(`${day}T00:00:00Z`),
    mood: 3,
    behaviour: null,
    sleepMinutes: null,
    note: null,
    createdById: 'parent-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.progressEntry.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListProgressService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListProgressService);
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('x', asUser('a', Role.ADMIN), {})).rejects.toThrow(NotFoundException);
  });

  it('403s for another parent and an unassigned clinician; allows own parent, assigned clinician, admin', async () => {
    await expect(service.list('child-1', asUser('other', Role.PARENT), {})).rejects.toThrow(
      ForbiddenException,
    );
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', asUser('cl-1', Role.CLINICIAN), {})).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.list('child-1', asUser('parent-1', Role.PARENT), {})).resolves.toBeDefined();
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a-1' });
    await expect(service.list('child-1', asUser('cl-1', Role.CLINICIAN), {})).resolves.toBeDefined();
    await expect(service.list('child-1', asUser('admin-1', Role.ADMIN), {})).resolves.toBeDefined();
  });

  it('orders by entryDate desc, applies from/to, and paginates with a cursor', async () => {
    prisma.progressEntry.findMany.mockResolvedValue([
      entry('e-3', '2026-10-03'),
      entry('e-2', '2026-10-02'),
      entry('e-1', '2026-10-01'),
    ]);
    const page = await service.list('child-1', asUser('parent-1', Role.PARENT), {
      limit: 2,
      from: '2026-10-01',
      to: '2026-10-03',
    });
    expect(page.data.map((d) => d.id)).toEqual(['e-3', 'e-2']);
    expect(page.data[0].entryDate).toBe('2026-10-03');
    expect(page.nextCursor).toBe(encodeCursor('e-2'));
    const args = prisma.progressEntry.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ entryDate: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(3);
    expect(args.where.entryDate).toEqual({
      gte: new Date('2026-10-01T00:00:00Z'),
      lte: new Date('2026-10-03T00:00:00Z'),
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListCallHistoryService } from './list-call-history.service';

describe('ListCallHistoryService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    monthlyCallLog: { findMany: jest.fn() },
  };
  let service: ListCallHistoryService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const logRow = {
    id: 'log-1',
    childId: 'child-1',
    clinicianId: 'clinician-1',
    calledAt: new Date('2026-09-22T15:30:00.000Z'),
    notes: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListCallHistoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListCallHistoryService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(
      service.list('missing', asUser('admin-1', Role.ADMIN), {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('child-1', asUser('clinician-1', Role.CLINICIAN), {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an assigned clinician and returns a page', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.monthlyCallLog.findMany.mockResolvedValue([logRow]);

    const result = await service.list('child-1', asUser('clinician-1', Role.CLINICIAN), {});

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('allows admin unconditionally', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.monthlyCallLog.findMany.mockResolvedValue([]);
    const result = await service.list('child-1', asUser('admin-1', Role.ADMIN), {});
    expect(result.data).toEqual([]);
  });

  it('derives nextCursor when a page overflows the limit', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.monthlyCallLog.findMany.mockResolvedValue([
      { ...logRow, id: 'log-1' },
      { ...logRow, id: 'log-2' },
    ]);

    const result = await service.list('child-1', asUser('admin-1', Role.ADMIN), { limit: 1 });

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
  });
});

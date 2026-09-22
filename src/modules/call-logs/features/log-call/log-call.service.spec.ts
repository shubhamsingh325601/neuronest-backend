import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { LogCallService } from './log-call.service';

describe('LogCallService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    monthlyCallLog: { create: jest.fn() },
  };
  let service: LogCallService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    prisma.monthlyCallLog.create.mockResolvedValue({
      id: 'log-1',
      childId: 'child-1',
      clinicianId: 'clinician-1',
      calledAt: new Date('2026-09-22T15:30:00.000Z'),
      notes: 'Went well',
      createdAt: new Date(),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [LogCallService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(LogCallService);
  });

  it('404s a missing child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(
      service.log('missing', asUser('admin-1', Role.ADMIN), {
        calledAt: '2026-09-22T15:30:00.000Z',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.log('child-1', asUser('clinician-1', Role.CLINICIAN), {
        calledAt: '2026-09-22T15:30:00.000Z',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an assigned clinician to log a call', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    const result = await service.log('child-1', asUser('clinician-1', Role.CLINICIAN), {
      calledAt: '2026-09-22T15:30:00.000Z',
      notes: 'Went well',
    });
    expect(result.notes).toBe('Went well');
  });

  it('allows admin unconditionally', async () => {
    const result = await service.log('child-1', asUser('admin-1', Role.ADMIN), {
      calledAt: '2026-09-22T15:30:00.000Z',
    });
    expect(result.id).toBe('log-1');
  });
});

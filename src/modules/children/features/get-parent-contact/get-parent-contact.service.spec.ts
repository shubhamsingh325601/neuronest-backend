import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetParentContactService } from './get-parent-contact.service';

describe('GetParentContactService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
  };
  let service: GetParentContactService;
  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ parent: { name: 'Pat Parent', email: 'pat@example.com' } });
    const moduleRef = await Test.createTestingModule({
      providers: [GetParentContactService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetParentContactService);
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.get('x', as('ad-1', Role.ADMIN))).rejects.toThrow(NotFoundException);
  });

  it('returns name and email to an assigned expert', async () => {
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
    await expect(service.get('child-1', as('ex-1', Role.EXPERT))).resolves.toEqual({
      name: 'Pat Parent',
      email: 'pat@example.com',
    });
  });

  it('refuses an unassigned expert', async () => {
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.get('child-1', as('ex-2', Role.EXPERT))).rejects.toThrow(ForbiddenException);
  });

  it('returns it to ADMIN', async () => {
    await expect(service.get('child-1', as('ad-1', Role.ADMIN))).resolves.toMatchObject({
      email: 'pat@example.com',
    });
  });

  it('refuses the parent and a clinician', async () => {
    await expect(service.get('child-1', as('parent-1', Role.PARENT))).rejects.toThrow(ForbiddenException);
    await expect(service.get('child-1', as('cl-1', Role.CLINICIAN))).rejects.toThrow(ForbiddenException);
  });
});

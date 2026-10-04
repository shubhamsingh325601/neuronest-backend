import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { WithdrawConsentService } from './withdraw-consent.service';

describe('WithdrawConsentService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    mediaConsent: { updateMany: jest.fn(), findMany: jest.fn() },
  };
  let service: WithdrawConsentService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    const moduleRef = await Test.createTestingModule({
      providers: [WithdrawConsentService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(WithdrawConsentService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.withdraw('x', asUser('parent-1', Role.PARENT))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403s for a non-owner and for admin', async () => {
    await expect(service.withdraw('child-1', asUser('other', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.withdraw('child-1', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('closes only the open row and returns the resulting state', async () => {
    const at = new Date();
    prisma.mediaConsent.updateMany.mockResolvedValue({ count: 1 });
    prisma.mediaConsent.findMany.mockResolvedValue([
      {
        id: 'c-1',
        consentVersion: 'v1',
        grantedAt: at,
        withdrawnAt: at,
        supersededAt: null,
        createdAt: at,
      },
    ]);
    const state = await service.withdraw('child-1', asUser('parent-1', Role.PARENT));
    expect(prisma.mediaConsent.updateMany).toHaveBeenCalledWith({
      where: { childId: 'child-1', withdrawnAt: null, supersededAt: null },
      data: { withdrawnAt: expect.any(Date) },
    });
    expect(state.status).toBe('WITHDRAWN');
    expect(state.current).toBeNull();
  });

  it('is a no-op returning NONE when nothing was ever granted', async () => {
    prisma.mediaConsent.updateMany.mockResolvedValue({ count: 0 });
    prisma.mediaConsent.findMany.mockResolvedValue([]);
    const state = await service.withdraw('child-1', asUser('parent-1', Role.PARENT));
    expect(state).toEqual({ status: 'NONE', current: null, history: [] });
  });
});

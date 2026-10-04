import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { GetConsentService } from './get-consent.service';

describe('GetConsentService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    mediaConsent: { findMany: jest.fn() },
  };
  let service: GetConsentService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const at = new Date();
  const open = {
    id: 'c-2',
    consentVersion: 'v2',
    grantedAt: at,
    withdrawnAt: null,
    supersededAt: null,
    createdAt: at,
  };
  const superseded = { ...open, id: 'c-1', consentVersion: 'v1', supersededAt: at };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.mediaConsent.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [GetConsentService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetConsentService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.get('x', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("403s for another parent's child", async () => {
    await expect(service.get('child-1', asUser('other', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('reports NONE with no rows', async () => {
    const state = await service.get('child-1', asUser('parent-1', Role.PARENT));
    expect(state.status).toBe('NONE');
  });

  it('reports GRANTED with the open row as current', async () => {
    prisma.mediaConsent.findMany.mockResolvedValue([open, superseded]);
    const state = await service.get('child-1', asUser('admin-1', Role.ADMIN));
    expect(state.status).toBe('GRANTED');
    expect(state.current?.consentVersion).toBe('v2');
    expect(state.history).toHaveLength(2);
  });

  it('reports WITHDRAWN when the latest row was withdrawn', async () => {
    prisma.mediaConsent.findMany.mockResolvedValue([{ ...open, withdrawnAt: at }]);
    const state = await service.get('child-1', asUser('parent-1', Role.PARENT));
    expect(state.status).toBe('WITHDRAWN');
    expect(state.current).toBeNull();
  });
});

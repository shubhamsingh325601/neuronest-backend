import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { GrantConsentService } from './grant-consent.service';

describe('GrantConsentService', () => {
  const tx = { mediaConsent: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() } };
  const prisma = {
    child: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: GrantConsentService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c-1',
    childId: 'child-1',
    grantedById: 'parent-1',
    consentVersion: 'v1',
    grantedAt: new Date(),
    withdrawnAt: null,
    supersededAt: null,
    createdAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    const moduleRef = await Test.createTestingModule({
      providers: [GrantConsentService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GrantConsentService);
  });

  const parent = asUser('parent-1', Role.PARENT);

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.grant('x', parent, { consentVersion: 'v1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403s for another parent and for admin', async () => {
    await expect(
      service.grant('child-1', asUser('other', Role.PARENT), { consentVersion: 'v1' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.grant('child-1', asUser('admin-1', Role.ADMIN), { consentVersion: 'v1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates a new row when none is open', async () => {
    tx.mediaConsent.findFirst.mockResolvedValue(null);
    tx.mediaConsent.create.mockResolvedValue(row());
    const result = await service.grant('child-1', parent, { consentVersion: 'v1' });
    expect(result.created).toBe(true);
    expect(tx.mediaConsent.update).not.toHaveBeenCalled();
  });

  it('is idempotent for the same open version', async () => {
    tx.mediaConsent.findFirst.mockResolvedValue(row());
    const result = await service.grant('child-1', parent, { consentVersion: 'v1' });
    expect(result.created).toBe(false);
    expect(tx.mediaConsent.create).not.toHaveBeenCalled();
  });

  it('supersedes the open row when the version changes', async () => {
    tx.mediaConsent.findFirst.mockResolvedValue(row());
    tx.mediaConsent.create.mockResolvedValue(row({ id: 'c-2', consentVersion: 'v2' }));
    const result = await service.grant('child-1', parent, { consentVersion: 'v2' });
    expect(result.created).toBe(true);
    expect(tx.mediaConsent.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { supersededAt: expect.any(Date) },
    });
  });

  it('retries once after a unique-index race and returns the idempotent row', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    tx.mediaConsent.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    tx.mediaConsent.create.mockRejectedValueOnce(p2002);
    const result = await service.grant('child-1', parent, { consentVersion: 'v1' });
    expect(result.created).toBe(false);
  });
});

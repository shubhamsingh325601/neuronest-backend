import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { SuspendUserService } from './suspend-user.service';

describe('SuspendUserService', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const refreshTokens = { revokeAllForUser: jest.fn() };
  let service: SuspendUserService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SuspendUserService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(SuspendUserService);
  });

  it('409s on self-suspend without touching the database', async () => {
    await expect(service.suspend('admin-1', 'admin-1')).rejects.toThrow(ConflictException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the target user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.suspend('missing', 'admin-1')).rejects.toThrow(NotFoundException);
  });

  it('suspends an ACTIVE user and revokes all sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.ACTIVE,
      updatedAt: new Date(),
    });
    const updated = { id: 'u1', status: UserStatus.SUSPENDED, updatedAt: new Date() };
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.suspend('u1', 'admin-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: UserStatus.SUSPENDED },
      select: { id: true, status: true, updatedAt: true },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(result).toEqual(updated);
  });

  it('suspends an INVITED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.INVITED,
      updatedAt: new Date(),
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      status: UserStatus.SUSPENDED,
      updatedAt: new Date(),
    });

    await service.suspend('u1', 'admin-1');
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('is idempotent when the user is already SUSPENDED', async () => {
    const current = { id: 'u1', status: UserStatus.SUSPENDED, updatedAt: new Date() };
    prisma.user.findUnique.mockResolvedValue(current);

    const result = await service.suspend('u1', 'admin-1');

    expect(result).toEqual(current);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('409s suspending a DEACTIVATED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.DEACTIVATED,
      updatedAt: new Date(),
    });
    await expect(service.suspend('u1', 'admin-1')).rejects.toThrow(ConflictException);
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { ChangePasswordService } from './change-password.service';

describe('ChangePasswordService', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const passwords = { hash: jest.fn(), verify: jest.fn() };
  const refreshTokens = { revokeAllForUser: jest.fn() };
  let service: ChangePasswordService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChangePasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(ChangePasswordService);
  });

  it('401s on a wrong current password, without touching the password column', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'hash-1' });
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.change('u1', { currentPassword: 'wrong', newPassword: 'a-new-strong-passphrase' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('401s when the user has no password set yet (e.g. INVITED)', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: null });

    await expect(
      service.change('u1', { currentPassword: 'anything', newPassword: 'a-new-strong-passphrase' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('hashes the new password, persists it, and revokes every session', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'hash-1' });
    passwords.verify.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('hash-2');
    const updatedAt = new Date();
    prisma.user.update.mockResolvedValue({ updatedAt });

    const result = await service.change('u1', {
      currentPassword: 'correct',
      newPassword: 'a-new-strong-passphrase',
    });

    expect(passwords.hash).toHaveBeenCalledWith('a-new-strong-passphrase');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'hash-2' },
      select: { updatedAt: true },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ status: 'PASSWORD_CHANGED', updatedAt });
  });
});

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ResetPasswordService } from './reset-password.service';

describe('ResetPasswordService', () => {
  const prisma = { user: { update: jest.fn() } };
  const passwords = { hash: jest.fn() };
  const verificationTokens = { consumePasswordResetToken: jest.fn() };
  const refreshTokens = { revokeAllForUser: jest.fn() };
  let service: ResetPasswordService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResetPasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(ResetPasswordService);
  });

  it('sets a new hash and revokes every session on a valid token', async () => {
    verificationTokens.consumePasswordResetToken.mockResolvedValue('u1');
    passwords.hash.mockResolvedValue('new-hash');

    await expect(service.reset({ token: 't'.repeat(30), newPassword: 'brand-new-pass' })).resolves.toEqual({
      reset: true,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
  });

  it('rejects an invalid or expired token', async () => {
    verificationTokens.consumePasswordResetToken.mockResolvedValue(null);
    await expect(
      service.reset({ token: 'x'.repeat(30), newPassword: 'brand-new-pass' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

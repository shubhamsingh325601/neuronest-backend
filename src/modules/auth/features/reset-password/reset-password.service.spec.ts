import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ResetPasswordService } from './reset-password.service';

describe('ResetPasswordService', () => {
  const prisma = { user: { update: jest.fn(), findUnique: jest.fn() } };
  const passwords = { hash: jest.fn() };
  const verificationTokens = {
    consumePasswordResetToken: jest.fn(),
    verifyPasswordResetCode: jest.fn(),
    revokePasswordReset: jest.fn(),
  };
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

    await expect(
      service.reset({ token: 't'.repeat(30), newPassword: 'brand-new-pass' }),
    ).resolves.toEqual({
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

  it('resets with an email and 6-digit code', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    verificationTokens.verifyPasswordResetCode.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('new-hash');

    await expect(
      service.reset({ email: 'Parent@Example.com', code: '123456', newPassword: 'brand-new-pass' }),
    ).resolves.toEqual({ reset: true });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'parent@example.com' },
      select: { id: true },
    });
    expect(verificationTokens.verifyPasswordResetCode).toHaveBeenCalledWith('u1', '123456');
    expect(verificationTokens.revokePasswordReset).toHaveBeenCalledWith('u1');
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
  });

  it('gives the same error for a wrong code and an unknown account', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
    verificationTokens.verifyPasswordResetCode.mockResolvedValue(false);
    const wrongCode = await service
      .reset({ email: 'a@b.co', code: '000000', newPassword: 'brand-new-pass' })
      .catch((e: BadRequestException) => e);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await service
      .reset({ email: 'x@y.co', code: '000000', newPassword: 'brand-new-pass' })
      .catch((e: BadRequestException) => e);
    expect(wrongCode).toBeInstanceOf(BadRequestException);
    expect((unknown as BadRequestException).getResponse()).toEqual(
      (wrongCode as BadRequestException).getResponse(),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('requires exactly one of token or email+code', async () => {
    await expect(service.reset({ newPassword: 'brand-new-pass' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.reset({
        token: 't'.repeat(30),
        email: 'a@b.co',
        code: '123456',
        newPassword: 'brand-new-pass',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reset({ email: 'a@b.co', newPassword: 'brand-new-pass' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

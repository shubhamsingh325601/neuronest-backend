import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { CompleteAccountSetupService } from './complete-account-setup.service';

describe('CompleteAccountSetupService', () => {
  const prisma = { user: { update: jest.fn() } };
  const passwords = { hash: jest.fn() };
  const verificationTokens = { consumeAccountSetupToken: jest.fn() };
  let service: CompleteAccountSetupService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompleteAccountSetupService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: VerificationTokenService, useValue: verificationTokens },
      ],
    }).compile();
    service = moduleRef.get(CompleteAccountSetupService);
  });

  it('sets the hash and activates the account on a valid token', async () => {
    verificationTokens.consumeAccountSetupToken.mockResolvedValue('u1');
    passwords.hash.mockResolvedValue('new-hash');

    await expect(
      service.complete({ token: 't'.repeat(43), password: 'brand-new-pass' }),
    ).resolves.toEqual({ complete: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        passwordHash: 'new-hash',
        status: 'ACTIVE',
        emailVerifiedAt: expect.any(Date),
      },
    });
  });

  it('rejects an invalid or expired token with INVALID_SETUP_TOKEN', async () => {
    verificationTokens.consumeAccountSetupToken.mockResolvedValue(null);

    await expect(
      service.complete({ token: 'x'.repeat(43), password: 'brand-new-pass' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

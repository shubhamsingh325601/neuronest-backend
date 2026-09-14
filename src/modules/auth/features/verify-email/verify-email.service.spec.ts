import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { VerifyEmailService } from './verify-email.service';

describe('VerifyEmailService', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const verificationTokens = {
    verifyEmailCode: jest.fn(),
    issueEmailVerificationCode: jest.fn(),
  };
  const email = { sendEmailVerificationCode: jest.fn() };
  let service: VerifyEmailService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerifyEmailService,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(VerifyEmailService);
  });

  it('sets emailVerifiedAt on a correct code', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerifiedAt: null });
    verificationTokens.verifyEmailCode.mockResolvedValue(true);

    await expect(service.verify({ email: 'p@example.com', code: '123456' })).resolves.toEqual({
      verified: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });

  it('rejects a wrong code without touching the user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerifiedAt: null });
    verificationTokens.verifyEmailCode.mockResolvedValue(false);

    await expect(
      service.verify({ email: 'p@example.com', code: '000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('gives the same generic error for an unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.verify({ email: 'nobody@example.com', code: '123456' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is idempotent for an already-verified account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerifiedAt: new Date() });
    await expect(service.verify({ email: 'p@example.com', code: 'whatever' })).resolves.toEqual({
      verified: true,
    });
    expect(verificationTokens.verifyEmailCode).not.toHaveBeenCalled();
  });

  it('resend never reveals whether the account exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.resend({ email: 'nobody@example.com' })).resolves.toBeUndefined();
    expect(email.sendEmailVerificationCode).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'p@example.com', emailVerifiedAt: null });
    verificationTokens.issueEmailVerificationCode.mockResolvedValue('654321');
    await service.resend({ email: 'p@example.com' });
    expect(email.sendEmailVerificationCode).toHaveBeenCalledWith('p@example.com', '654321');
  });
});

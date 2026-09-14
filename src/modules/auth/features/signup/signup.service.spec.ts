import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { SignupService } from './signup.service';

describe('SignupService', () => {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
  };
  const passwords = { hash: jest.fn() };
  const verificationTokens = { issueEmailVerificationCode: jest.fn() };
  const email = { sendEmailVerificationCode: jest.fn() };
  let service: SignupService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(SignupService);
  });

  it('creates a PARENT/ACTIVE user, hashes the password, and emails a code', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    passwords.hash.mockResolvedValue('hashed');
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'p@example.com' });
    verificationTokens.issueEmailVerificationCode.mockResolvedValue('123456');

    const result = await service.signup({
      email: 'P@Example.com',
      password: 'a-strong-passphrase',
      name: '  Jordan  ',
    });

    expect(passwords.hash).toHaveBeenCalledWith('a-strong-passphrase');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'p@example.com',
          passwordHash: 'hashed',
          name: 'Jordan',
          role: 'PARENT',
          status: 'ACTIVE',
          emailVerifiedAt: null,
        }),
      }),
    );
    expect(email.sendEmailVerificationCode).toHaveBeenCalledWith('p@example.com', '123456');
    expect(result).toEqual({ id: 'u1', email: 'p@example.com' });
  });

  it('rejects a already-verified email with 409', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      emailVerifiedAt: new Date(),
    });

    await expect(
      service.signup({ email: 'p@example.com', password: 'a-strong-passphrase', name: 'J' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('resends a code for an existing unverified account without creating a new user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      emailVerifiedAt: null,
    });
    verificationTokens.issueEmailVerificationCode.mockResolvedValue('654321');

    const result = await service.signup({
      email: 'p@example.com',
      password: 'a-strong-passphrase',
      name: 'J',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(email.sendEmailVerificationCode).toHaveBeenCalledWith('p@example.com', '654321');
    expect(result).toEqual({ id: 'u1', email: 'p@example.com' });
  });
});

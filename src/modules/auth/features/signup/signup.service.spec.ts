import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthEmailJobs } from '@modules/auth/jobs/auth-email.jobs';
import { SignupService } from './signup.service';

describe('SignupService', () => {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const passwords = { hash: jest.fn() };
  const emailJobs = { enqueueVerificationCode: jest.fn(), kick: jest.fn() };
  let service: SignupService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: AuthEmailJobs, useValue: emailJobs },
      ],
    }).compile();
    service = moduleRef.get(SignupService);
  });

  it('creates a PARENT/ACTIVE user, hashes the password, and queues a code email in the same transaction', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    passwords.hash.mockResolvedValue('hashed');
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'p@example.com' });
    emailJobs.enqueueVerificationCode.mockResolvedValue(true);

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
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(emailJobs.enqueueVerificationCode).toHaveBeenCalledWith(prisma, 'u1');
    expect(emailJobs.kick).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'u1', email: 'p@example.com' });
  });

  it('rejects a already-verified email with 409', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      role: 'PARENT',
      emailVerifiedAt: new Date(),
    });

    await expect(
      service.signup({ email: 'p@example.com', password: 'a-strong-passphrase', name: 'J' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('replaces credentials of an unverified PARENT, revokes sessions, and re-issues the code in one transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      role: 'PARENT',
      emailVerifiedAt: null,
    });
    passwords.hash.mockResolvedValue('new-hash');

    const result = await service.signup({
      email: 'p@example.com',
      password: 'a-strong-passphrase',
      name: '  Jordan ',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'new-hash', name: 'Jordan' },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(emailJobs.enqueueVerificationCode).toHaveBeenCalledWith(prisma, 'u1', {
      replaceOutstanding: true,
    });
    expect(emailJobs.kick).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'u1', email: 'p@example.com' });
  });

  it.each(['CLINICIAN', 'ADMIN'])(
    'rejects an existing unverified %s row with 409 and mutates nothing',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'c@example.com',
        role,
        emailVerifiedAt: null,
      });

      await expect(
        service.signup({ email: 'c@example.com', password: 'a-strong-passphrase', name: 'J' }),
      ).rejects.toMatchObject({ response: { code: 'EMAIL_ALREADY_REGISTERED' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(emailJobs.enqueueVerificationCode).not.toHaveBeenCalled();
    },
  );

  it('re-runs the existing-user branch when a concurrent first signup wins the create race', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u1',
      email: 'p@example.com',
      role: 'PARENT',
      emailVerifiedAt: null,
    });
    passwords.hash.mockResolvedValue('hashed');
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );

    const result = await service.signup({
      email: 'p@example.com',
      password: 'a-strong-passphrase',
      name: 'J',
    });

    expect(prisma.user.update).toHaveBeenCalled();
    expect(result).toEqual({ id: 'u1', email: 'p@example.com' });
  });
});

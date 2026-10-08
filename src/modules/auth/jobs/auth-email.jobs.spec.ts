import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailService } from '@common/email/email.service';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { AuthEmailJobs, EMAIL_VERIFICATION_JOB, PASSWORD_RESET_JOB } from './auth-email.jobs';

describe('AuthEmailJobs', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const tokens = {
    issueEmailVerificationCode: jest.fn(),
    issuePasswordResetToken: jest.fn(),
    issuePasswordResetCode: jest.fn(),
    revokeEmailVerification: jest.fn(),
  };
  const email = { sendEmailVerificationCode: jest.fn(), sendPasswordResetLink: jest.fn() };
  const queue = { enqueue: jest.fn(), kick: jest.fn() };
  let registry: JobHandlerRegistry;
  let jobs: AuthEmailJobs;

  beforeEach(async () => {
    jest.resetAllMocks();
    registry = new JobHandlerRegistry();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthEmailJobs,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationTokenService, useValue: tokens },
        { provide: EmailService, useValue: email },
        { provide: JobHandlerRegistry, useValue: registry },
        { provide: JobQueueService, useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://app.example') },
        },
      ],
    }).compile();
    jobs = moduleRef.get(AuthEmailJobs);
    jobs.onModuleInit();
  });

  describe('enqueue', () => {
    it('uses a userId-only payload and a minute-bucketed dedupe key (no secrets)', async () => {
      const tx = {} as never;
      await jobs.enqueueVerificationCode(tx, 'u1');
      await jobs.enqueuePasswordReset(tx, 'u1');

      const [verification, reset] = queue.enqueue.mock.calls.map((c) => c[1]);
      expect(verification).toMatchObject({
        type: EMAIL_VERIFICATION_JOB,
        payload: { userId: 'u1' },
      });
      expect(verification.dedupeKey).toMatch(/^email\.verification-code:u1:\d+$/);
      expect(reset).toMatchObject({ type: PASSWORD_RESET_JOB, payload: { userId: 'u1' } });
      expect(reset.dedupeKey).toMatch(/^email\.password-reset:u1:\d+$/);
    });
  });

  describe('enqueueVerificationCode({ replaceOutstanding })', () => {
    it('consumes outstanding codes in the caller transaction and never dedupes', async () => {
      const tx = {} as never;
      await jobs.enqueueVerificationCode(tx, 'u1', { replaceOutstanding: true });
      await jobs.enqueueVerificationCode(tx, 'u1', { replaceOutstanding: true });

      expect(tokens.revokeEmailVerification).toHaveBeenCalledWith('u1', tx);
      const [a, b] = queue.enqueue.mock.calls.map((c) => c[1].dedupeKey);
      expect(a).not.toBe(b);
    });
  });

  describe('verification-code handler', () => {
    const run = (payload: object = { userId: 'u1' }) =>
      registry.get(EMAIL_VERIFICATION_JOB)!({
        id: 'j',
        type: EMAIL_VERIFICATION_JOB,
        payload,
        attempt: 1,
      });

    it('mints the code at send time and emails it', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'p@example.com', emailVerifiedAt: null });
      tokens.issueEmailVerificationCode.mockResolvedValue('123456');
      await run();
      expect(tokens.issueEmailVerificationCode).toHaveBeenCalledWith('u1');
      expect(email.sendEmailVerificationCode).toHaveBeenCalledWith('p@example.com', '123456');
    });

    it('is a no-op once the user is verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'p@example.com',
        emailVerifiedAt: new Date(),
      });
      await run();
      expect(tokens.issueEmailVerificationCode).not.toHaveBeenCalled();
      expect(email.sendEmailVerificationCode).not.toHaveBeenCalled();
    });

    it('is a no-op when the user is gone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await run();
      expect(email.sendEmailVerificationCode).not.toHaveBeenCalled();
    });

    it('propagates a provider failure so the queue retries', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'p@example.com', emailVerifiedAt: null });
      tokens.issueEmailVerificationCode.mockResolvedValue('123456');
      email.sendEmailVerificationCode.mockRejectedValue(new Error('provider down'));
      await expect(run()).rejects.toThrow('provider down');
    });

    it('rejects a malformed payload', async () => {
      await expect(run({})).rejects.toThrow(/no userId/);
    });
  });

  describe('password-reset handler', () => {
    const run = () =>
      registry.get(PASSWORD_RESET_JOB)!({
        id: 'j',
        type: PASSWORD_RESET_JOB,
        payload: { userId: 'u1' },
        attempt: 1,
      });

    it('mints the token and the code at send time and emails both', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'p@example.com' });
      tokens.issuePasswordResetToken.mockResolvedValue('tok');
      tokens.issuePasswordResetCode.mockResolvedValue('654321');
      await run();
      expect(email.sendPasswordResetLink).toHaveBeenCalledWith(
        'p@example.com',
        'https://app.example/reset-password?token=tok',
        '654321',
      );
    });

    it('is a no-op when the user is gone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await run();
      expect(tokens.issuePasswordResetToken).not.toHaveBeenCalled();
    });
  });

  it('kick delegates to the queue', async () => {
    await jobs.kick();
    expect(queue.kick).toHaveBeenCalledTimes(1);
  });
});

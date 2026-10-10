import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { EmailService } from '@common/email/email.service';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ACCOUNT_SETUP_JOB, InvitationService } from './invitation.service';

describe('InvitationService', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const verificationTokens = { issueAccountSetupToken: jest.fn() };
  const email = { sendAccountSetupLink: jest.fn() };
  const queue = { enqueue: jest.fn(), kick: jest.fn() };
  let registry: JobHandlerRegistry;
  let service: InvitationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    registry = new JobHandlerRegistry();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationService,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: EmailService, useValue: email },
        { provide: JobHandlerRegistry, useValue: registry },
        { provide: JobQueueService, useValue: queue },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://app.example/') } },
      ],
    }).compile();
    service = moduleRef.get(InvitationService);
  });

  it('enqueues a userId-only payload with a fresh key each time (no secret in the job)', async () => {
    const tx = {} as never;
    await service.enqueue(tx, 'u1');
    await service.enqueue(tx, 'u1');

    const [first, second] = queue.enqueue.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({ type: ACCOUNT_SETUP_JOB, payload: { userId: 'u1' } });
    expect(JSON.stringify(first)).not.toMatch(/token|url|http/i);
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
  });

  it('keeps the frontend callbackUrl in the payload (not a secret) when one is given', async () => {
    await service.enqueue({} as never, 'u1', 'https://app.example/set-password');
    expect(queue.enqueue.mock.calls[0][1].payload).toEqual({
      userId: 'u1',
      callbackUrl: 'https://app.example/set-password',
    });
  });

  it('emails a link to the callbackUrl page when the job carries one', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'sam@clinic.example',
      status: UserStatus.INVITED,
    });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');
    await service.issueAndSend('u1', 'https://app.example/set-password');
    expect(email.sendAccountSetupLink).toHaveBeenCalledWith(
      'sam@clinic.example',
      'https://app.example/set-password?token=tok123',
    );
  });

  it('registers itself as the account-setup handler', async () => {
    service.onModuleInit();
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.example', status: UserStatus.INVITED });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok');

    await registry.get(ACCOUNT_SETUP_JOB)!({
      id: 'j',
      type: ACCOUNT_SETUP_JOB,
      payload: { userId: 'u1' },
      attempt: 1,
    });

    expect(email.sendAccountSetupLink).toHaveBeenCalled();
  });

  it('rejects a payload without a userId', async () => {
    service.onModuleInit();
    await expect(
      registry.get(ACCOUNT_SETUP_JOB)!({
        id: 'j',
        type: ACCOUNT_SETUP_JOB,
        payload: {},
        attempt: 1,
      }),
    ).rejects.toThrow(/no userId/);
  });

  it('mints a token and emails the plain setup link to an INVITED clinician', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'sam@clinic.example',
      status: UserStatus.INVITED,
    });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');

    await service.issueAndSend('u1');

    expect(verificationTokens.issueAccountSetupToken).toHaveBeenCalledWith('u1');
    expect(email.sendAccountSetupLink).toHaveBeenCalledWith(
      'sam@clinic.example',
      'https://app.example/complete-account-setup?token=tok123',
    );
  });

  it.each([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    'is a no-op (no token, no email) when the user is %s by run time',
    async (status) => {
      prisma.user.findUnique.mockResolvedValue({ email: 'sam@clinic.example', status });
      await service.issueAndSend('u1');
      expect(verificationTokens.issueAccountSetupToken).not.toHaveBeenCalled();
      expect(email.sendAccountSetupLink).not.toHaveBeenCalled();
    },
  );

  it('is a no-op when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await service.issueAndSend('u1');
    expect(email.sendAccountSetupLink).not.toHaveBeenCalled();
  });

  it('propagates a send failure so the queue retries', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'sam@clinic.example',
      status: UserStatus.INVITED,
    });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');
    email.sendAccountSetupLink.mockRejectedValue(new Error('provider down'));

    await expect(service.issueAndSend('u1')).rejects.toThrow('provider down');
  });
});

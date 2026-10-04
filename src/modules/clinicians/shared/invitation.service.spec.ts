import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { InvitationService } from './invitation.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('InvitationService', () => {
  const prisma = { user: { findUniqueOrThrow: jest.fn() } };
  const verificationTokens = { issueAccountSetupToken: jest.fn() };
  const email = { sendAccountSetupLink: jest.fn() };
  let service: InvitationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationService,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://app.example/') } },
      ],
    }).compile();
    service = moduleRef.get(InvitationService);
  });

  it('mints a token and emails the plain setup link', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'sam@clinic.example' });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');

    await service.issueAndSend('u1');

    expect(verificationTokens.issueAccountSetupToken).toHaveBeenCalledWith('u1');
    expect(email.sendAccountSetupLink).toHaveBeenCalledWith(
      'sam@clinic.example',
      'https://app.example/complete-account-setup?token=tok123',
    );
  });

  it('issueAndSend propagates a send failure', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'sam@clinic.example' });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');
    email.sendAccountSetupLink.mockRejectedValue(new Error('provider down'));

    await expect(service.issueAndSend('u1')).rejects.toThrow('provider down');
  });

  it('sendBestEffort swallows a send failure', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'sam@clinic.example' });
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');
    email.sendAccountSetupLink.mockRejectedValue(new Error('provider down'));

    await expect(service.sendBestEffort('u1')).resolves.toBeUndefined();
  });
});

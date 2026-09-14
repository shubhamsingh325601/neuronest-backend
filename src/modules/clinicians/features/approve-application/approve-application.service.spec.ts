import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ApproveApplicationService } from './approve-application.service';

const app = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1',
  name: 'Dr. Sam',
  email: 'Sam@Clinic.Example',
  context: 'ctx',
  status: 'PENDING',
  reviewNote: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ApproveApplicationService', () => {
  const prisma = {
    clinicianApplication: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const verificationTokens = { issueAccountSetupToken: jest.fn() };
  const email = { sendAccountSetupLink: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('https://app.example/') };
  let service: ApproveApplicationService;

  const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
    } catch (err) {
      return ((err as HttpException).getResponse() as { code: string }).code;
    }
    throw new Error('expected the promise to reject');
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    config.get.mockReturnValue('https://app.example/');
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApproveApplicationService,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationTokenService, useValue: verificationTokens },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(ApproveApplicationService);
  });

  it('provisions an INVITED clinician, moves the app to APPROVED, and emails a setup link', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app());
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([
      { id: 'u1', email: 'sam@clinic.example' },
      app({ status: 'APPROVED' }),
    ]);
    verificationTokens.issueAccountSetupToken.mockResolvedValue('tok123');

    const res = await service.approve('a1');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'sam@clinic.example',
          name: 'Dr. Sam',
          role: 'CLINICIAN',
          status: 'INVITED',
          passwordHash: null,
          emailVerifiedAt: null,
        }),
      }),
    );
    expect(verificationTokens.issueAccountSetupToken).toHaveBeenCalledWith('u1');
    expect(email.sendAccountSetupLink).toHaveBeenCalledWith(
      'sam@clinic.example',
      'https://app.example/complete-account-setup?token=tok123',
    );
    expect(res).toEqual({
      application: expect.objectContaining({ status: 'APPROVED' }),
      clinicianUserId: 'u1',
    });
  });

  it('404s when the application does not exist', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(null);
    await expect(service.approve('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('409 APPLICATION_DECISION_FINAL when already REJECTED', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app({ status: 'REJECTED' }));
    await expect(service.approve('a1')).rejects.toBeInstanceOf(ConflictException);
    await expect(codeOf(service.approve('a1'))).resolves.toBe('APPLICATION_DECISION_FINAL');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when already APPROVED', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app({ status: 'APPROVED' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    const res = await service.approve('a1');

    expect(res).toEqual({
      application: expect.objectContaining({ status: 'APPROVED' }),
      clinicianUserId: 'u1',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(email.sendAccountSetupLink).not.toHaveBeenCalled();
  });

  it('409 EMAIL_ALREADY_REGISTERED and leaves status untouched when a user with that email exists', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app());
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(codeOf(service.approve('a1'))).resolves.toBe('EMAIL_ALREADY_REGISTERED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.clinicianApplication.update).not.toHaveBeenCalled();
  });
});

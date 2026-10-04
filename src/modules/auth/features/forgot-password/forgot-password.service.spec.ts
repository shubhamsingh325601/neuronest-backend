import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthEmailJobs } from '@modules/auth/jobs/auth-email.jobs';
import { ForgotPasswordService } from './forgot-password.service';

describe('ForgotPasswordService', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const emailJobs = { enqueuePasswordReset: jest.fn(), kick: jest.fn() };
  let service: ForgotPasswordService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ForgotPasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthEmailJobs, useValue: emailJobs },
      ],
    }).compile();
    service = moduleRef.get(ForgotPasswordService);
  });

  it('queues a reset email for an existing account and kicks', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'p@example.com' });
    await service.requestReset({ email: ' P@Example.com ' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'p@example.com' } });
    expect(emailJobs.enqueuePasswordReset).toHaveBeenCalledWith(prisma, 'u1');
    expect(emailJobs.kick).toHaveBeenCalledTimes(1);
  });

  it('resolves silently for an unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.requestReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();
    expect(emailJobs.enqueuePasswordReset).not.toHaveBeenCalled();
  });
});

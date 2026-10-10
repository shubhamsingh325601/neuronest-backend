import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { CallbackUrlService } from '@common/email/callback-url.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { ResendInvitationService } from './resend-invitation.service';

describe('ResendInvitationService', () => {
  const prisma = { user: { findFirst: jest.fn() }, $transaction: jest.fn() };
  const invitations = { enqueue: jest.fn(), kick: jest.fn() };
  let service: ResendInvitationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResendInvitationService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvitationService, useValue: invitations },
        {
          provide: CallbackUrlService,
          useValue: { assertAllowed: (url?: string) => url },
        },
      ],
    }).compile();
    service = moduleRef.get(ResendInvitationService);
  });

  it('404s CLINICIAN_NOT_FOUND when the id is not a clinician', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resend('x', {})).rejects.toMatchObject({
      response: { code: 'CLINICIAN_NOT_FOUND' },
    });
  });

  it.each([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    '409s CLINICIAN_NOT_INVITED when the clinician is %s',
    async (status) => {
      prisma.user.findFirst.mockResolvedValue({ id: 'c1', status });
      await expect(service.resend('c1', {})).rejects.toMatchObject({
        response: { code: 'CLINICIAN_NOT_INVITED' },
      });
      expect(invitations.enqueue).not.toHaveBeenCalled();
    },
  );

  it('queues a fresh invitation for an INVITED clinician and kicks after commit', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'c1', status: UserStatus.INVITED });
    await service.resend('c1', {});
    expect(invitations.enqueue).toHaveBeenCalledWith(prisma, 'c1', undefined);
    expect(invitations.kick).toHaveBeenCalledTimes(1);
  });
});

import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { ResendInvitationService } from './resend-invitation.service';

describe('ResendInvitationService', () => {
  const prisma = { user: { findFirst: jest.fn() } };
  const invitations = { issueAndSend: jest.fn() };
  let service: ResendInvitationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResendInvitationService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvitationService, useValue: invitations },
      ],
    }).compile();
    service = moduleRef.get(ResendInvitationService);
  });

  it('404s CLINICIAN_NOT_FOUND when the id is not a clinician', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resend('x')).rejects.toMatchObject({
      response: { code: 'CLINICIAN_NOT_FOUND' },
    });
  });

  it.each([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    '409s CLINICIAN_NOT_INVITED when the clinician is %s',
    async (status) => {
      prisma.user.findFirst.mockResolvedValue({ id: 'c1', status });
      await expect(service.resend('c1')).rejects.toMatchObject({
        response: { code: 'CLINICIAN_NOT_INVITED' },
      });
      expect(invitations.issueAndSend).not.toHaveBeenCalled();
    },
  );

  it('re-sends to an INVITED clinician and surfaces a send failure', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'c1', status: UserStatus.INVITED });
    await service.resend('c1');
    expect(invitations.issueAndSend).toHaveBeenCalledWith('c1');

    invitations.issueAndSend.mockRejectedValue(new Error('provider down'));
    await expect(service.resend('c1')).rejects.toThrow('provider down');
  });
});

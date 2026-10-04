import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { UpdateClinicianService } from './update-clinician.service';

const detailRow = {
  id: 'c1',
  name: 'Dr. Sam',
  email: 'sam@clinic.example',
  role: Role.CLINICIAN,
  status: UserStatus.INVITED,
  createdAt: new Date(),
  emailVerifiedAt: null,
  lastLoginAt: null,
  verificationTokens: [],
  clinicianProfile: null,
  clinicianAssignments: [],
};

describe('UpdateClinicianService', () => {
  const prisma = { user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
  const invitations = { sendBestEffort: jest.fn() };
  let service: UpdateClinicianService;

  const givenClinician = (status: UserStatus) =>
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'c1', email: 'sam@clinic.example', status })
      .mockResolvedValue(detailRow);

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UpdateClinicianService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvitationService, useValue: invitations },
      ],
    }).compile();
    service = moduleRef.get(UpdateClinicianService);
  });

  it('404s CLINICIAN_NOT_FOUND for a non-clinician id', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.update('x', { name: 'n' })).rejects.toMatchObject({
      response: { code: 'CLINICIAN_NOT_FOUND' },
    });
  });

  it('updates name and upserts the profile without re-inviting', async () => {
    givenClinician(UserStatus.ACTIVE);

    await service.update('c1', { name: 'New', profile: { bio: 'hi' } });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        name: 'New',
        clinicianProfile: { upsert: { create: { bio: 'hi' }, update: { bio: 'hi' } } },
      },
    });
    expect(invitations.sendBestEffort).not.toHaveBeenCalled();
  });

  it('changes the email while INVITED and re-invites the new address', async () => {
    givenClinician(UserStatus.INVITED);
    prisma.user.findUnique.mockResolvedValue(null);

    await service.update('c1', { email: ' New@Clinic.Example ' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { email: 'new@clinic.example' },
    });
    expect(invitations.sendBestEffort).toHaveBeenCalledWith('c1');
  });

  it.each([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    '409s CLINICIAN_EMAIL_LOCKED when the clinician is %s',
    async (status) => {
      givenClinician(status);
      await expect(service.update('c1', { email: 'new@clinic.example' })).rejects.toMatchObject({
        response: { code: 'CLINICIAN_EMAIL_LOCKED' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('treats re-sending the unchanged email as a no-op even after activation', async () => {
    givenClinician(UserStatus.ACTIVE);
    await service.update('c1', { email: 'SAM@clinic.example' });
    expect(invitations.sendBestEffort).not.toHaveBeenCalled();
  });

  it('409s EMAIL_ALREADY_REGISTERED when the new email is taken', async () => {
    givenClinician(UserStatus.INVITED);
    prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(service.update('c1', { email: 'taken@clinic.example' })).rejects.toMatchObject({
      response: { code: 'EMAIL_ALREADY_REGISTERED' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

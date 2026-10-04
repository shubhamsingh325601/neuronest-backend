import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { CreateClinicianService } from './create-clinician.service';

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

describe('CreateClinicianService', () => {
  const prisma = { user: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn() } };
  const invitations = { sendBestEffort: jest.fn() };
  let service: CreateClinicianService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateClinicianService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvitationService, useValue: invitations },
      ],
    }).compile();
    service = moduleRef.get(CreateClinicianService);
  });

  it('creates an INVITED user (+ profile) with a normalised email, then invites after create', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'c1' });
    prisma.user.findFirst.mockResolvedValue(detailRow);

    const result = await service.create({
      name: 'Dr. Sam',
      email: '  Sam@Clinic.Example ',
      profile: { specialisation: 'OT' },
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'sam@clinic.example',
        name: 'Dr. Sam',
        role: Role.CLINICIAN,
        status: UserStatus.INVITED,
        passwordHash: null,
        emailVerifiedAt: null,
        clinicianProfile: { create: { specialisation: 'OT' } },
      },
      select: { id: true },
    });
    expect(invitations.sendBestEffort).toHaveBeenCalledWith('c1');
    expect(prisma.user.create.mock.invocationCallOrder[0]).toBeLessThan(
      invitations.sendBestEffort.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({ id: 'c1', status: 'INVITED', assignedChildIds: [] });
  });

  it('409s EMAIL_ALREADY_REGISTERED when the email exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(service.create({ name: 'x', email: 'sam@clinic.example' })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(invitations.sendBestEffort).not.toHaveBeenCalled();
  });

  it('maps a unique-violation race to the same 409', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.create({ name: 'x', email: 'sam@clinic.example' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_ALREADY_REGISTERED' } });
  });
});

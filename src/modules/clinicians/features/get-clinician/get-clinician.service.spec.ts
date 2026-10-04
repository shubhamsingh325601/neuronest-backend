import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetClinicianService } from './get-clinician.service';

describe('GetClinicianService', () => {
  const prisma = { user: { findFirst: jest.fn() } };
  let service: GetClinicianService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetClinicianService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetClinicianService);
  });

  it('404s CLINICIAN_NOT_FOUND when the id is not a clinician', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing', role: Role.CLINICIAN } }),
    );
  });

  it('returns nulls for a legacy clinician with no profile and derives lifecycle fields', async () => {
    const sent = new Date('2026-03-01T00:00:00Z');
    const expires = new Date('2026-03-04T00:00:00Z');
    const verifiedAt = new Date('2026-03-02T00:00:00Z');
    prisma.user.findFirst.mockResolvedValue({
      id: 'c1',
      name: 'Dr. Sam',
      email: 'sam@clinic.example',
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      emailVerifiedAt: verifiedAt,
      lastLoginAt: null,
      verificationTokens: [{ createdAt: sent, expiresAt: expires }],
      clinicianProfile: null,
      clinicianAssignments: [{ childId: 'k1' }, { childId: 'k2' }],
    });

    const result = await service.get('c1');

    expect(result.profile).toEqual({
      phone: null,
      specialisation: null,
      qualifications: null,
      licenseNumber: null,
      bio: null,
    });
    expect(result).toMatchObject({
      activatedAt: verifiedAt,
      lastLoginAt: null,
      invitationSentAt: sent,
      invitationExpiresAt: expires,
      assignedChildIds: ['k1', 'k2'],
    });
  });
});

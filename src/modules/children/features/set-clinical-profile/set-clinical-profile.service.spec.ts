import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { SetClinicalProfileService } from './set-clinical-profile.service';

describe('SetClinicalProfileService', () => {
  const child = { findUnique: jest.fn(), update: jest.fn() };
  const clinicianChildAssignment = { findUnique: jest.fn() };
  let service: SetClinicalProfileService;
  const dto = { strengths: [], sensoryTraits: [], calmingPreferences: [] };

  beforeEach(async () => {
    child.findUnique.mockReset();
    child.update.mockReset();
    clinicianChildAssignment.findUnique.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SetClinicalProfileService,
        { provide: PrismaService, useValue: { child, clinicianChildAssignment } },
      ],
    }).compile();
    service = moduleRef.get(SetClinicalProfileService);
  });

  it('404s for an unknown child', async () => {
    child.findUnique.mockResolvedValue(null);
    await expect(
      service.set('c1', { id: 'a', role: Role.ADMIN } as never, dto as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s an unassigned clinician and a parent', async () => {
    child.findUnique.mockResolvedValue({ id: 'c1' });
    clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.set('c1', { id: 'k', role: Role.CLINICIAN } as never, dto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.set('c1', { id: 'p', role: Role.PARENT } as never, dto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores the profile for an assigned clinician', async () => {
    child.findUnique.mockResolvedValue({ id: 'c1' });
    clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'asg' });
    child.update.mockResolvedValue({ id: 'c1' });
    await service.set('c1', { id: 'k', role: Role.CLINICIAN } as never, dto as never);
    expect(child.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: { clinicalProfile: dto } }),
    );
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetApplicationService } from './get-application.service';

describe('GetApplicationService', () => {
  const prisma = { clinicianApplication: { findUnique: jest.fn() } };
  let service: GetApplicationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetApplicationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(GetApplicationService);
  });

  it('returns the mapped application when it exists', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue({
      id: 'a1',
      name: 'Dr. Sam',
      email: 'sam@clinic.example',
      context: 'ctx',
      status: 'PENDING',
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.getById('a1')).resolves.toMatchObject({ id: 'a1', status: 'PENDING' });
  });

  it('throws APPLICATION_NOT_FOUND when it does not', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(null);

    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

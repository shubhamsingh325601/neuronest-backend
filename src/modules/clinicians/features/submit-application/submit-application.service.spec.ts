import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { SubmitApplicationService } from './submit-application.service';

describe('SubmitApplicationService', () => {
  const prisma = { clinicianApplication: { create: jest.fn() } };
  let service: SubmitApplicationService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SubmitApplicationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SubmitApplicationService);
  });

  it('creates a trimmed, lower-cased PENDING lead', async () => {
    prisma.clinicianApplication.create.mockResolvedValue({ id: 'ca1', status: 'PENDING' });

    const result = await service.submit({
      name: '  Dr. Sam  ',
      email: '  SAM@Clinic.Example ',
      context: '  interested  ',
    });

    expect(prisma.clinicianApplication.create).toHaveBeenCalledWith({
      data: { name: 'Dr. Sam', email: 'sam@clinic.example', context: 'interested' },
      select: { id: true, status: true },
    });
    expect(result).toEqual({ id: 'ca1', status: 'PENDING' });
  });
});

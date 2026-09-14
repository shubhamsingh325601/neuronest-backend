import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { RejectApplicationService } from './reject-application.service';

const app = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1',
  name: 'Dr. Sam',
  email: 'sam@clinic.example',
  context: 'ctx',
  status: 'PENDING',
  reviewNote: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('RejectApplicationService', () => {
  const prisma = {
    clinicianApplication: { findUnique: jest.fn(), update: jest.fn() },
  };
  let service: RejectApplicationService;

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
    const moduleRef = await Test.createTestingModule({
      providers: [
        RejectApplicationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(RejectApplicationService);
  });

  it('rejects a PENDING application and stores the trimmed reason', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app());
    prisma.clinicianApplication.update.mockResolvedValue(
      app({ status: 'REJECTED', reviewNote: 'Not enough ASD experience.' }),
    );

    const res = await service.reject('a1', { reason: '  Not enough ASD experience.  ' });

    expect(prisma.clinicianApplication.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'REJECTED', reviewNote: 'Not enough ASD experience.' },
    });
    expect(res.application).toMatchObject({ status: 'REJECTED' });
  });

  it('stores null when no reason is given', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app());
    prisma.clinicianApplication.update.mockResolvedValue(app({ status: 'REJECTED' }));

    await service.reject('a1', {});

    expect(prisma.clinicianApplication.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'REJECTED', reviewNote: null },
    });
  });

  it('404s when the application does not exist', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(null);
    await expect(service.reject('missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 APPLICATION_DECISION_FINAL when already APPROVED', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(app({ status: 'APPROVED' }));
    await expect(service.reject('a1', {})).rejects.toBeInstanceOf(ConflictException);
    await expect(codeOf(service.reject('a1', {}))).resolves.toBe('APPLICATION_DECISION_FINAL');
    expect(prisma.clinicianApplication.update).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when already REJECTED (keeps the existing note)', async () => {
    prisma.clinicianApplication.findUnique.mockResolvedValue(
      app({ status: 'REJECTED', reviewNote: 'original reason' }),
    );

    const res = await service.reject('a1', { reason: 'a different reason' });

    expect(prisma.clinicianApplication.update).not.toHaveBeenCalled();
    expect(res.application).toMatchObject({ status: 'REJECTED', reviewNote: 'original reason' });
  });
});

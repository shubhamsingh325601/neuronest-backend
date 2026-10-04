import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetJobService } from './get-job.service';

describe('GetJobService', () => {
  const prisma = { job: { findUnique: jest.fn() } };
  let service: GetJobService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetJobService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetJobService);
  });

  it('returns the job, payload included', async () => {
    const now = new Date();
    prisma.job.findUnique.mockResolvedValue({
      id: 'j1',
      type: 't',
      status: JobStatus.DEAD,
      priority: 0,
      payload: { userId: 'u1' },
      runAt: now,
      attempts: 5,
      maxAttempts: 5,
      lastError: 'boom',
      lockedAt: null,
      lockedBy: 'internal',
      dedupeKey: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    const dto = await service.getById('j1');
    expect(dto.payload).toEqual({ userId: 'u1' });
    expect(dto).not.toHaveProperty('lockedBy');
  });

  it('404 JOB_NOT_FOUND', async () => {
    prisma.job.findUnique.mockResolvedValue(null);
    await expect(service.getById('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

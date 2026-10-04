import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RequeueJobService } from './requeue-job.service';

describe('RequeueJobService', () => {
  const prisma = {
    job: { updateMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const queue = { kick: jest.fn() };
  let service: RequeueJobService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RequeueJobService,
        { provide: PrismaService, useValue: prisma },
        { provide: JobQueueService, useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(RequeueJobService);
  });

  it('flips only a DEAD job to PENDING with attempts reset, then kicks', async () => {
    prisma.job.updateMany.mockResolvedValue({ count: 1 });
    prisma.job.findUniqueOrThrow.mockResolvedValue({ id: 'j1', status: JobStatus.PENDING });

    const dto = await service.requeue('j1');

    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: 'j1', status: JobStatus.DEAD },
      data: expect.objectContaining({ status: JobStatus.PENDING, attempts: 0 }),
    });
    expect(queue.kick).toHaveBeenCalled();
    expect(dto.status).toBe(JobStatus.PENDING);
  });

  it('404 JOB_NOT_FOUND for an unknown id', async () => {
    prisma.job.updateMany.mockResolvedValue({ count: 0 });
    prisma.job.findUnique.mockResolvedValue(null);
    await expect(service.requeue('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 JOB_NOT_DEAD for a job in any other state', async () => {
    prisma.job.updateMany.mockResolvedValue({ count: 0 });
    prisma.job.findUnique.mockResolvedValue({ id: 'j1' });
    const err = await service.requeue('j1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'JOB_NOT_DEAD' });
    expect(queue.kick).not.toHaveBeenCalled();
  });
});

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { JobDto } from '@modules/admin/shared/job.dto';

@Injectable()
export class RequeueJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Only a `DEAD` job can be requeued. The status flip is one conditional update, so two
   * concurrent requeues cannot both succeed; `lastError` is kept for context.
   */
  async requeue(id: string): Promise<JobDto> {
    const flipped = await this.prisma.job.updateMany({
      where: { id, status: JobStatus.DEAD },
      data: {
        status: JobStatus.PENDING,
        attempts: 0,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        completedAt: null,
      },
    });
    if (flipped.count === 0) {
      const exists = await this.prisma.job.findUnique({ where: { id }, select: { id: true } });
      if (!exists) {
        throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found.' });
      }
      throw new ConflictException({
        code: 'JOB_NOT_DEAD',
        message: 'Only a DEAD job can be requeued.',
      });
    }

    const job = await this.prisma.job.findUniqueOrThrow({ where: { id } });
    await this.queue.kick();
    return JobDto.from(job);
  }
}

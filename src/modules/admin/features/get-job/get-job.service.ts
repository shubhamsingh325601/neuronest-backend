import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { JobDto } from '@modules/admin/shared/job.dto';

@Injectable()
export class GetJobService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<JobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found.' });
    }
    return JobDto.from(job);
  }
}

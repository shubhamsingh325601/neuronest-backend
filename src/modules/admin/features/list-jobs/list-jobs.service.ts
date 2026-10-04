import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { JobDto } from '@modules/admin/shared/job.dto';
import { ListJobsQueryDto, ListJobsResponseDto } from './dto/list-jobs.dto';

/** Admin job list (`?status=DEAD` is the error list), newest first. Guarded by `job:read`. */
@Injectable()
export class ListJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListJobsQueryDto): Promise<ListJobsResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.JobWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const rows = await this.prisma.job.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(JobDto.from), nextCursor: page.nextCursor };
  }
}

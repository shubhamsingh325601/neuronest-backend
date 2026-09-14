import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  decodeCursor,
  toCursorPage,
} from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications.query.dto';
import { ListApplicationsResponseDto } from './dto/list-applications.response.dto';

/**
 * Admin review queue. Cursor-paginated on a stable `(createdAt desc, id desc)` sort so
 * rows are neither skipped nor repeated as items leave the queue mid-paging (the reason
 * cursors were chosen over offsets — see docs/api-conventions.md).
 */
@Injectable()
export class ListApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListApplicationsQueryDto): Promise<ListApplicationsResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.ClinicianApplicationWhereInput = query.status
      ? { status: query.status }
      : {};

    const rows = await this.prisma.clinicianApplication.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }
        : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return {
      data: page.data.map(ClinicianApplicationDto.from),
      nextCursor: page.nextCursor,
    };
  }
}

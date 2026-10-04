import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { parseDateOnly } from '@modules/progress/shared/date.util';
import { assertChildProgressAccess } from '@modules/progress/shared/progress-access';
import { ProgressEntryDto } from '@modules/progress/shared/progress.dto';
import { ListProgressQueryDto, ListProgressResponseDto } from './dto/list-progress.dto';

/** Cursor-paginated progress log, `entryDate desc` (plan 0013 §3 row 8). */
@Injectable()
export class ListProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListProgressQueryDto,
  ): Promise<ListProgressResponseDto> {
    await assertChildProgressAccess(this.prisma, childId, caller, 'read');

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.progressEntry.findMany({
      where: {
        childId,
        ...(query.from || query.to
          ? {
              entryDate: {
                ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
                ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map((row) => ProgressEntryDto.from(row)), nextCursor: page.nextCursor };
  }
}

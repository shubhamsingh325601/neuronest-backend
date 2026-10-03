import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserSummaryDto } from '@modules/users/shared/user-summary.dto';
import { ListUsersQueryDto } from './dto/list-users.query.dto';
import { ListUsersResponseDto } from './dto/list-users.response.dto';

/**
 * General admin directory (C1, plan 0008) — every role, optionally filtered by
 * `?role=&status=`. Admin-only via the guard (`user:list`), no ownership branching
 * needed — same shape as `list-clinicians.service.ts`, just unfiltered by role.
 */
@Injectable()
export class ListUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQueryDto): Promise<ListUsersResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(UserSummaryDto.from), nextCursor: page.nextCursor };
  }
}

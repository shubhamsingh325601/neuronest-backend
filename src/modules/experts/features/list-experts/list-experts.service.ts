import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertDto } from '@modules/experts/shared/expert.dto';
import { ListExpertsQueryDto } from './dto/list-experts.query.dto';
import { ListExpertsResponseDto } from './dto/list-experts.response.dto';

/**
 * Admin-only directory of EXPERT users. Optional `?status=` and `?q=` (case-insensitive
 * substring over name/email) filters.
 */
@Injectable()
export class ListExpertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListExpertsQueryDto): Promise<ListExpertsResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.UserWhereInput = {
      role: Role.EXPERT,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(ExpertDto.from), nextCursor: page.nextCursor };
  }
}

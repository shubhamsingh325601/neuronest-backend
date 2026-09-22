import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { MonthlyCallLogDto } from '@modules/call-logs/shared/monthly-call-log.dto';
import { ListCallHistoryQueryDto } from './dto/list-call-history.query.dto';
import { ListCallHistoryResponseDto } from './dto/list-call-history.response.dto';

/**
 * Cursor-paginated call history for a child, sorted `(calledAt desc, id desc)` —
 * newest-first, matching every other list in this codebase except `PlanNote`'s. Same
 * assignment-existence scoping as `monthly-call:create`; `PARENT` does not hold this
 * permission at all (docs/rbac.md).
 */
@Injectable()
export class ListCallHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListCallHistoryQueryDto,
  ): Promise<ListCallHistoryResponseDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw this.forbidden();
      }
    }
    // ADMIN: no check.

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.monthlyCallLog.findMany({
      where: { childId },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(MonthlyCallLogDto.from), nextCursor: page.nextCursor };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

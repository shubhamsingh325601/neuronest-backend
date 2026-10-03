import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { ListPlansQueryDto } from './dto/list-plans.query.dto';
import { ListPlansResponseDto } from './dto/list-plans.response.dto';

/**
 * Cursor-paginated plan history for a child (B2, plan 0008) — closes the gap where
 * `today-focus` only ever returned the currently-`ACTIVE` plan, with no way to see a
 * `COMPLETED`/`ARCHIVED` one again. `plan:read` ownership is the same existence-check
 * shape as `GetChildService` (docs/rbac.md §6), walked from `Child` directly (every
 * plan in the response already shares this `childId`, so there's no need to check
 * each row individually).
 */
@Injectable()
export class ListPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListPlansQueryDto,
  ): Promise<ListPlansResponseDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.PARENT) {
      if (child.parentId !== caller.id) {
        throw this.forbidden();
      }
    } else if (caller.role === Role.CLINICIAN) {
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
    const where: Prisma.PlanWhereInput = { childId, ...(query.status ? { status: query.status } : {}) };
    const rows = await this.prisma.plan.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(PlanDto.from), nextCursor: page.nextCursor };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

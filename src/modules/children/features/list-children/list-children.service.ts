import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChildDto } from '@modules/children/shared/child.dto';
import { ListChildrenQueryDto } from './dto/list-children.query.dto';
import { ListChildrenResponseDto } from './dto/list-children.response.dto';

/**
 * `child:read` is one permission for all three roles (see docs/rbac.md §6); the guard
 * only checks the caller holds it. Here that resolves to a query filter, not a
 * per-row existence check — the same *shape* as `plan-template:read`'s status filter:
 * - PARENT: own child only.
 * - CLINICIAN: children with a live `ClinicianChildAssignment` for this caller.
 * - ADMIN: unfiltered.
 */
@Injectable()
export class ListChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListChildrenQueryDto,
    caller: AuthenticatedUser,
  ): Promise<ListChildrenResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.ChildWhereInput =
      caller.role === Role.PARENT
        ? { parentId: caller.id }
        : caller.role === Role.CLINICIAN
          ? { clinicianAssignments: { some: { clinicianId: caller.id } } }
          : {};

    const rows = await this.prisma.child.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(ChildDto.from), nextCursor: page.nextCursor };
  }
}

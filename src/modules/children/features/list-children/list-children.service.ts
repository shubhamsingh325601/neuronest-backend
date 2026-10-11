import { ForbiddenException, Injectable } from '@nestjs/common';
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
 * - EXPERT: children with a live `ExpertChildAssignment` for this caller.
 * - ADMIN: unfiltered. Any other role is refused.
 */
@Injectable()
export class ListChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListChildrenQueryDto,
    caller: AuthenticatedUser,
  ): Promise<ListChildrenResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    let where: Prisma.ChildWhereInput;
    switch (caller.role) {
      case Role.PARENT:
        where = { parentId: caller.id };
        break;
      case Role.CLINICIAN:
        where = { clinicianAssignments: { some: { clinicianId: caller.id } } };
        break;
      case Role.EXPERT:
        where = { expertAssignments: { some: { expertId: caller.id } } };
        break;
      case Role.ADMIN:
        where = {};
        break;
      default:
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        });
    }

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

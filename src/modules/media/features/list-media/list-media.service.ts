import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { MediaDto } from '@modules/media/shared/media.dto';
import { ListMediaQueryDto } from './dto/list-media.query.dto';
import { ListMediaResponseDto } from './dto/list-media.response.dto';

/**
 * Cursor-paginated media gallery for a child. `media:read` is one permission granted
 * to PARENT, CLINICIAN, and ADMIN alike — ownership is enforced here, per role, the
 * same shape as `GetChildService` (see docs/rbac.md §6):
 * - PARENT: must be the child's own parent.
 * - CLINICIAN: must have a live ClinicianChildAssignment for this child.
 * - ADMIN: unconditional.
 */
@Injectable()
export class ListMediaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListMediaQueryDto,
  ): Promise<ListMediaResponseDto> {
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
    const rows = await this.prisma.media.findMany({
      where: { childId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(MediaDto.from), nextCursor: page.nextCursor };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

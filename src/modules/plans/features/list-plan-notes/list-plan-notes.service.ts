import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanNoteDto } from '@modules/plans/shared/plan-note.dto';
import { ListPlanNotesQueryDto } from './dto/list-plan-notes.query.dto';
import { ListPlanNotesResponseDto } from './dto/list-plan-notes.response.dto';

/**
 * Cursor-paginated note thread on a plan. Sorted `(createdAt asc, id asc)` —
 * **oldest-first**, unlike every other list in this codebase, because a coordination
 * thread reads chronologically (§5 of plan 0006 — do not "fix" this to match the
 * newest-first convention elsewhere). Same assignment-existence scoping as
 * `plan-note:create`; `PARENT` does not hold this permission at all (docs/rbac.md).
 */
@Injectable()
export class ListPlanNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    planId: string,
    caller: AuthenticatedUser,
    query: ListPlanNotesQueryDto,
  ): Promise<ListPlanNotesResponseDto> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { id: true, childId: true },
    });
    if (!plan) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'No plan with that id.' });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId: plan.childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw this.forbidden();
      }
    }
    // ADMIN: no check.

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.planNote.findMany({
      where: { planId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(PlanNoteDto.from), nextCursor: page.nextCursor };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

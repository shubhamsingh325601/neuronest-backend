import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianChildAssignmentDto } from '@modules/children/shared/clinician-child-assignment.dto';

/**
 * A child's full care team. `child:read` is reused (§3 row 1 of plan 0008) — same
 * ownership shape as `GetChildService` (docs/rbac.md §6):
 * - PARENT: must be the child's own parent.
 * - CLINICIAN: must have a live ClinicianChildAssignment for this child — and, once
 *   admitted, sees the *full* care team (every clinician assigned), not just their own
 *   row (§3 row 4 of plan 0008 — same "clinician-to-clinician coordination" framing as
 *   `plan-note:read`).
 * - ADMIN: unconditional.
 *
 * No pagination (§3 row 3 of plan 0008) — a child's care team is bounded by business
 * rule, unlike an unbounded-over-time list.
 */
@Injectable()
export class ListClinicianAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
  ): Promise<ClinicianChildAssignmentDto[]> {
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

    const rows = await this.prisma.clinicianChildAssignment.findMany({
      where: { childId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(ClinicianChildAssignmentDto.from);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

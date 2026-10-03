import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanDto } from '@modules/plans/shared/plan.dto';

/**
 * Reads a single plan by id (B3, plan 0008) — same existence-check shape as
 * `plan:manage`/`plan:read` (docs/rbac.md §6), walked from `Plan.childId` (§3 row 9 of
 * plan 0008): loads the `Plan` first (`404 PLAN_NOT_FOUND` if missing) then applies the
 * identical ownership check against its `childId`.
 */
@Injectable()
export class GetPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string, caller: AuthenticatedUser): Promise<PlanDto> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'No plan with that id.' });
    }

    if (caller.role === Role.PARENT) {
      const child = await this.prisma.child.findUnique({
        where: { id: plan.childId },
        select: { parentId: true },
      });
      if (child?.parentId !== caller.id) {
        throw this.forbidden();
      }
    } else if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId: plan.childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw this.forbidden();
      }
    }
    // ADMIN: no check.

    return PlanDto.from(plan);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

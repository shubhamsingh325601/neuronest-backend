import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanDto } from '@modules/plans/shared/plan.dto';

/**
 * CLINICIAN(assigned)/ADMIN archives a plan. `ACTIVE`/`ARCHIVED` → `ARCHIVED`,
 * idempotent. `COMPLETED` → `409 PLAN_ALREADY_FINAL` — both are terminal states, and
 * transitioning between them is not an implicit side effect of this endpoint (§3 row 4
 * of plan 0006).
 */
@Injectable()
export class ArchivePlanService {
  constructor(private readonly prisma: PrismaService) {}

  async archive(id: string, caller: AuthenticatedUser): Promise<PlanDto> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'No plan with that id.' });
    }

    await this.assertManageAccess(plan.childId, caller);

    if (plan.status === PlanStatus.ARCHIVED) {
      return PlanDto.from(plan);
    }
    if (plan.status === PlanStatus.COMPLETED) {
      throw new ConflictException({
        code: 'PLAN_ALREADY_FINAL',
        message: 'This plan is already completed; reversing that is not supported.',
      });
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: { status: PlanStatus.ARCHIVED },
    });
    return PlanDto.from(updated);
  }

  private async assertManageAccess(childId: string, caller: AuthenticatedUser): Promise<void> {
    if (caller.role === Role.ADMIN) {
      return;
    }
    const assignment = await this.prisma.clinicianChildAssignment.findUnique({
      where: { clinicianId_childId: { clinicianId: caller.id, childId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
  }
}

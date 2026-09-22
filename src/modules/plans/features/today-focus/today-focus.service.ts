import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanTemplateDayDto } from '@modules/plans/shared/plan-template.dto';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { computeDayNumber } from './day-offset.util';
import { TodayFocusResponseDto } from './dto/today-focus.response.dto';

/**
 * Computed read, no new table (§3 row 8 of plan 0006). Same ownership branch as
 * `GetChildService` (docs/rbac.md §6). Finds the child's `ACTIVE` plan
 * (`404 PLAN_NOT_FOUND` if none) and joins to the `PlanTemplateDay` matching today's
 * offset — a day outside the template's range is `day: null`, not an error.
 */
@Injectable()
export class TodayFocusService {
  constructor(private readonly prisma: PrismaService) {}

  async get(childId: string, caller: AuthenticatedUser): Promise<TodayFocusResponseDto> {
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

    const plan = await this.prisma.plan.findFirst({
      where: { childId, status: PlanStatus.ACTIVE },
      include: { planTemplate: { include: { days: true } } },
    });
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'This child has no active plan.',
      });
    }

    const dayNumber = computeDayNumber(plan.startDate, new Date());
    const day = plan.planTemplate.days.find((d) => d.dayNumber === dayNumber) ?? null;

    return {
      plan: PlanDto.from(plan),
      day: day ? PlanTemplateDayDto.from(day) : null,
    };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

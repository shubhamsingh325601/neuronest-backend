import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { atLocalDate, computeDayNumber } from '@modules/plans/features/today-focus/day-offset.util';
import { assertChildCarePlanAccess } from '@modules/care-plan/shared/care-plan-access';
import { CarePlanDto, WEEK_INCLUDE, toWeekDto } from '@modules/care-plan/shared/care-plan.dto';

/**
 * Read model for the Today / Care plan / Daily activities screens. `currentWeek` and `currentDayOfWeek`
 * come from the plan's `startDate` against the caller's local calendar day (`tzOffsetMinutes`, UTC by default) and are clamped to the weeks that exist.
 */
@Injectable()
export class GetCarePlanService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    childId: string,
    caller: AuthenticatedUser,
    now: Date = new Date(),
    tzOffsetMinutes = 0,
  ): Promise<CarePlanDto> {
    await assertChildCarePlanAccess(this.prisma, childId, caller, 'read');

    const plan = await this.prisma.plan.findFirst({
      where: { childId, status: PlanStatus.ACTIVE },
      include: { weeks: { include: WEEK_INCLUDE, orderBy: { weekNumber: 'asc' } } },
    });
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'This child has no active plan.',
      });
    }

    const totalWeeks = plan.weeks.reduce((max, w) => Math.max(max, w.weekNumber), 0);
    const dayNumber = Math.max(computeDayNumber(plan.startDate, atLocalDate(now, tzOffsetMinutes)), 1);
    const rawWeek = Math.floor((dayNumber - 1) / 7) + 1;
    const currentWeek = totalWeeks === 0 ? 1 : Math.min(rawWeek, totalWeeks);
    const currentDayOfWeek = rawWeek > currentWeek ? 7 : ((dayNumber - 1) % 7) + 1;

    const assignment = await this.prisma.clinicianChildAssignment.findFirst({
      where: { childId, clinician: { role: Role.CLINICIAN } },
      orderBy: { createdAt: 'asc' },
      select: { clinician: { select: { name: true } } },
    });

    return {
      planId: plan.id,
      startDate: plan.startDate,
      approvedAt: plan.createdAt,
      clinician: assignment ? { name: assignment.clinician.name } : null,
      currentWeek,
      currentDayOfWeek,
      totalWeeks,
      weeks: plan.weeks.map((week) => toWeekDto(week, currentWeek)),
    };
  }
}

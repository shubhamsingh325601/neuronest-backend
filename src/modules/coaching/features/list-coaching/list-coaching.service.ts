import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { CoachingTipDto, CoachingWeekDto } from '@modules/coaching/shared/coaching.dto';
import { weekOfDay } from '@modules/coaching/shared/week.util';
import { computeDayNumber } from '@modules/plans/features/today-focus/day-offset.util';
import { ListCoachingQueryDto } from './dto/list-coaching.query.dto';

/**
 * Coaching tips for a child's `ACTIVE` plan (plan 0012 decision 8). Scoping is the
 * `child:read` shape: parent-own, clinician-assigned, admin-any. A child with no active
 * plan, or a week outside the plan, yields an empty list — never an error. A completed or
 * archived plan does not resolve here, so its tips leave the parent's view.
 */
@Injectable()
export class ListCoachingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListCoachingQueryDto,
  ): Promise<CoachingWeekDto> {
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
      select: { id: true, startDate: true },
    });
    if (!plan) {
      return { weekNumber: null, tips: [] };
    }

    const week = query.week ?? 'current';
    let weekNumber: number;
    if (week === 'current') {
      const dayNumber = computeDayNumber(plan.startDate, new Date());
      if (dayNumber < 1) {
        return { weekNumber: null, tips: [] };
      }
      weekNumber = weekOfDay(dayNumber);
    } else {
      weekNumber = Number(week);
    }

    const tips = await this.prisma.coachingTip.findMany({
      where: { planId: plan.id, weekNumber },
      orderBy: { position: 'asc' },
    });
    return { weekNumber, tips: tips.map((t) => CoachingTipDto.from(t, caller.role)) };
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PlanStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  addDays,
  formatDateOnly,
  mondayOf,
  parseDateOnly,
  previousFullWeekStart,
} from '@modules/progress/shared/date.util';
import { assertChildProgressAccess } from '@modules/progress/shared/progress-access';
import { computeTrend, summariseWeek } from '@modules/progress/shared/summarise-week.util';
import { WeeklySummaryDto, WeeklySummaryQueryDto } from './dto/weekly-summary.dto';

/**
 * Computed (not authored) weekly rollup — plan 0013 §3 rows 6, 7, 9. Weeks are
 * Monday–Sunday UTC. One query fetches the requested week plus the prior one; a week with
 * no entries is a normal `200` with `daysLogged: 0`, never a `404`.
 */
@Injectable()
export class WeeklySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summarise(
    childId: string,
    caller: AuthenticatedUser,
    query: WeeklySummaryQueryDto,
    now: Date = new Date(),
  ): Promise<WeeklySummaryDto> {
    await assertChildProgressAccess(this.prisma, childId, caller, 'read');

    const weekStart = query.weekStart
      ? mondayOf(parseDateOnly(query.weekStart))
      : previousFullWeekStart(now);
    const weekEnd = addDays(weekStart, 6);
    const priorStart = addDays(weekStart, -7);

    const [rows, activePlan] = await Promise.all([
      this.prisma.progressEntry.findMany({
        where: { childId, entryDate: { gte: priorStart, lte: weekEnd } },
        select: { entryDate: true, mood: true, behaviour: true, sleepMinutes: true },
      }),
      this.prisma.plan.findFirst({
        where: { childId, status: PlanStatus.ACTIVE },
        select: { id: true, planTemplate: { select: { title: true } } },
      }),
    ]);

    const current = summariseWeek(rows.filter((r) => r.entryDate >= weekStart));
    const prior = summariseWeek(rows.filter((r) => r.entryDate < weekStart));

    return {
      weekStart: formatDateOnly(weekStart),
      weekEnd: formatDateOnly(weekEnd),
      ...current,
      trend: computeTrend(current, prior),
      activePlan: activePlan ? { id: activePlan.id, title: activePlan.planTemplate.title } : null,
    };
  }
}

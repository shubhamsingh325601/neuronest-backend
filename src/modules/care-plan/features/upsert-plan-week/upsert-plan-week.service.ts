import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { loadEditablePlan } from '@modules/plans/shared/load-editable-plan';
import { CarePlanWeekDto, WEEK_INCLUDE, toWeekDto } from '@modules/care-plan/shared/care-plan.dto';
import { MAX_PLAN_WEEKS, UpsertPlanWeekDto } from './dto/upsert-plan-week.dto';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/**
 * Replaces one plan week. Goals and activities are matched to existing rows by their position (array
 * order) so editing a week keeps the parent's completion marks on activities that stay in place; rows
 * past the new length are removed.
 */
@Injectable()
export class UpsertPlanWeekService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    planId: string,
    weekNumber: number,
    caller: AuthenticatedUser,
    dto: UpsertPlanWeekDto,
  ): Promise<CarePlanWeekDto> {
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > MAX_PLAN_WEEKS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `weekNumber must be between 1 and ${MAX_PLAN_WEEKS}.`,
      });
    }
    await loadEditablePlan(this.prisma, planId, caller);

    const row = await this.prisma.$transaction(async (tx) => {
      const week = await tx.planWeek.upsert({
        where: { planId_weekNumber: { planId, weekNumber } },
        create: {
          planId,
          weekNumber,
          title: dto.title.trim(),
          focus: dto.focus.trim(),
          guidance: dto.guidance ? json(dto.guidance) : Prisma.JsonNull,
        },
        update: {
          title: dto.title.trim(),
          focus: dto.focus.trim(),
          guidance: dto.guidance ? json(dto.guidance) : Prisma.JsonNull,
        },
      });

      for (const [index, goal] of dto.goals.entries()) {
        const data = {
          title: goal.title.trim(),
          description: goal.description.trim(),
          domain: goal.domain.trim(),
          icon: goal.icon ?? null,
        };
        await tx.planGoal.upsert({
          where: { weekId_position: { weekId: week.id, position: index + 1 } },
          create: { weekId: week.id, position: index + 1, ...data },
          update: data,
        });
      }
      await tx.planGoal.deleteMany({
        where: { weekId: week.id, position: { gt: dto.goals.length } },
      });

      for (const [index, activity] of dto.activities.entries()) {
        const data = {
          dayOfWeek: activity.dayOfWeek,
          title: activity.title.trim(),
          shortDescription: activity.shortDescription.trim(),
          goalCategory: activity.goalCategory.trim(),
          domain: activity.domain.trim(),
          durationMinutes: activity.durationMinutes,
          whyItMatters: activity.whyItMatters.trim(),
          steps: json(activity.steps),
          parentScript: activity.parentScript ? json(activity.parentScript) : Prisma.JsonNull,
          equipment: json(activity.equipment ?? []),
          clinicalReassurance: activity.clinicalReassurance ?? null,
        };
        await tx.planActivity.upsert({
          where: { weekId_position: { weekId: week.id, position: index + 1 } },
          create: { weekId: week.id, position: index + 1, ...data },
          update: data,
        });
      }
      await tx.planActivity.deleteMany({
        where: { weekId: week.id, position: { gt: dto.activities.length } },
      });

      return tx.planWeek.findUniqueOrThrow({ where: { id: week.id }, include: WEEK_INCLUDE });
    });

    // A write response is "as of now": the week's status is relative to itself.
    return toWeekDto(row, weekNumber);
  }
}

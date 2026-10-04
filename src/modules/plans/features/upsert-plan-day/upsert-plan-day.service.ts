import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { loadEditablePlan } from '@modules/plans/shared/load-editable-plan';
import { PlanDayDto } from '@modules/plans/shared/plan.dto';
import { UpsertPlanDayDto } from './dto/upsert-plan-day.dto';

/**
 * Assigned CLINICIAN/ADMIN creates or rewrites one day of an `ACTIVE` plan (plan 0016
 * §3 rows 6, 11). Any `dayNumber` 1..365 is allowed — days beyond the template's range
 * are fine. The edit is stamped with `updatedById`.
 */
@Injectable()
export class UpsertPlanDayService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    planId: string,
    dayNumber: number,
    caller: AuthenticatedUser,
    dto: UpsertPlanDayDto,
  ): Promise<PlanDayDto> {
    await loadEditablePlan(this.prisma, planId, caller);

    if (dto.sectionId) {
      const section = await this.prisma.planSection.findFirst({
        where: { id: dto.sectionId, planId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'sectionId does not belong to this plan.',
        });
      }
    }

    const data = {
      title: dto.title.trim(),
      instructions: dto.instructions.trim(),
      updatedById: caller.id,
      ...(dto.sectionId !== undefined ? { sectionId: dto.sectionId } : {}),
    };
    const day = await this.prisma.planDay.upsert({
      where: { planId_dayNumber: { planId, dayNumber } },
      create: { planId, dayNumber, ...data },
      update: data,
    });
    return PlanDayDto.from(day);
  }
}

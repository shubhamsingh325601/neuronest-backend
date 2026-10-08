import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { CoachingTipDto, CoachingWeekDto } from '@modules/coaching/shared/coaching.dto';
import { ReplaceCoachingDto } from './dto/replace-coaching.dto';

/**
 * Full, idempotent replacement of one plan week's tip set (plan 0012 decision 7): delete
 * + insert in one transaction, so a rerun never duplicates and `tips: []` clears the week.
 * `coaching:manage` is held by CLINICIAN and ADMIN; a CLINICIAN must be assigned to the
 * plan's child (same shape as `plan:manage`). Works on any plan status.
 */
@Injectable()
export class ReplaceCoachingService {
  constructor(private readonly prisma: PrismaService) {}

  async replace(
    planId: string,
    weekNumber: number,
    caller: AuthenticatedUser,
    dto: ReplaceCoachingDto,
  ): Promise<CoachingWeekDto> {
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
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        });
      }
    }
    // ADMIN: no check.

    const tips = await this.prisma.$transaction(async (tx) => {
      await tx.coachingTip.deleteMany({ where: { planId, weekNumber } });
      if (dto.tips.length > 0) {
        await tx.coachingTip.createMany({
          data: dto.tips.map((tip, index) => ({
            childId: plan.childId,
            planId,
            weekNumber,
            position: index + 1,
            title: tip.title,
            body: tip.body,
            whyItMatters: tip.whyItMatters,
            steps: tip.steps ?? [],
            scriptQuote: tip.scriptQuote,
            scriptContext: tip.scriptContext,
            authorId: caller.id,
          })),
        });
      }
      return tx.coachingTip.findMany({ where: { planId, weekNumber }, orderBy: { position: 'asc' } });
    });

    return { weekNumber, tips: tips.map((t) => CoachingTipDto.from(t, caller.role)) };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertChildCarePlanAccess } from '@modules/care-plan/shared/care-plan-access';
import { CarePlanActivityDto, toActivityDto } from '@modules/care-plan/shared/care-plan.dto';
import { CompleteActivityDto } from './dto/complete-activity.dto';

/** The activity must belong to the child's ACTIVE plan; anything else is a 404 that discloses nothing. */
export async function findActivityOfActivePlan(
  prisma: PrismaService,
  childId: string,
  activityId: string,
) {
  const activity = await prisma.planActivity.findFirst({
    where: { id: activityId, week: { plan: { childId, status: PlanStatus.ACTIVE } } },
    include: { completion: true, week: { select: { weekNumber: true } } },
  });
  if (!activity) {
    throw new NotFoundException({
      code: 'ACTIVITY_NOT_FOUND',
      message: 'No such activity in the active plan.',
    });
  }
  return activity;
}

@Injectable()
export class CompleteActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async complete(
    childId: string,
    activityId: string,
    caller: AuthenticatedUser,
    dto: CompleteActivityDto,
  ): Promise<{ created: boolean; activity: CarePlanActivityDto }> {
    await assertChildCarePlanAccess(this.prisma, childId, caller, 'parent-write');
    const activity = await findActivityOfActivePlan(this.prisma, childId, activityId);

    if (activity.completion) {
      return { created: false, activity: toActivityDto(activity, activity.week.weekNumber) };
    }

    try {
      const completion = await this.prisma.activityCompletion.create({
        data: {
          activityId,
          childId,
          completedById: caller.id,
          note: dto.note?.trim() || null,
        },
      });
      return {
        created: true,
        activity: toActivityDto({ ...activity, completion }, activity.week.weekNumber),
      };
    } catch (err) {
      // A concurrent retry created the row between our read and write: treat as already done.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const fresh = await findActivityOfActivePlan(this.prisma, childId, activityId);
        return { created: false, activity: toActivityDto(fresh, fresh.week.weekNumber) };
      }
      throw err;
    }
  }
}

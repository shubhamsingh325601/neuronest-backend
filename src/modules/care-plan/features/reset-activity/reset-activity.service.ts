import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertChildCarePlanAccess } from '@modules/care-plan/shared/care-plan-access';
import { findActivityOfActivePlan } from '@modules/care-plan/features/complete-activity/complete-activity.service';

@Injectable()
export class ResetActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async reset(childId: string, activityId: string, caller: AuthenticatedUser): Promise<void> {
    await assertChildCarePlanAccess(this.prisma, childId, caller, 'parent-write');
    await findActivityOfActivePlan(this.prisma, childId, activityId);
    await this.prisma.activityCompletion.deleteMany({ where: { activityId, childId } });
  }
}

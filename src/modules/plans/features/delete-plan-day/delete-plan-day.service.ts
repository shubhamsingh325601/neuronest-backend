import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { loadEditablePlan } from '@modules/plans/shared/load-editable-plan';

/** Removes one day of an `ACTIVE` plan. Idempotent — a missing day is not an error. */
@Injectable()
export class DeletePlanDayService {
  constructor(private readonly prisma: PrismaService) {}

  async delete(planId: string, dayNumber: number, caller: AuthenticatedUser): Promise<void> {
    await loadEditablePlan(this.prisma, planId, caller);
    await this.prisma.planDay.deleteMany({ where: { planId, dayNumber } });
  }
}

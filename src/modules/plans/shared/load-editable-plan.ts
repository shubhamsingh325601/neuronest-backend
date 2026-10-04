import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Plan, PlanStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * `plan:manage` for content edits: loads the plan (`404 PLAN_NOT_FOUND`), applies the
 * assigned-clinician/ADMIN ownership check (`403`), and requires the plan to be
 * `ACTIVE` (`409 PLAN_NOT_ACTIVE`) — completed/archived plans are frozen history.
 */
export async function loadEditablePlan(
  prisma: PrismaService,
  id: string,
  caller: AuthenticatedUser,
): Promise<Plan> {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) {
    throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'No plan with that id.' });
  }
  if (caller.role !== Role.ADMIN) {
    const assignment = await prisma.clinicianChildAssignment.findUnique({
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
  if (plan.status !== PlanStatus.ACTIVE) {
    throw new ConflictException({
      code: 'PLAN_NOT_ACTIVE',
      message: 'Only an active plan can be edited.',
    });
  }
  return plan;
}

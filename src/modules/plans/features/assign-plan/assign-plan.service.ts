import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Prisma, PlanStatus, PlanTemplateStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { snapshotTemplateIntoPlan } from '@modules/plans/shared/snapshot-template';
import { AssignPlanDto } from './dto/assign-plan.dto';

/**
 * CLINICIAN(assigned)/ADMIN assigns a `PUBLISHED` template to a child, creating a new
 * `ACTIVE` plan and snapshotting the template's sections/days into plan-owned rows (plan 0016). `plan:manage` scoping walks the same existence-check shape as
 * `child:read` (docs/rbac.md), from the child directly since there's no `Plan` row
 * yet. At most one `ACTIVE` plan per child is a service-layer invariant (§3 row 3 of
 * plan 0006) — `409 PLAN_ALREADY_ACTIVE` if one exists; the caller must
 * complete/archive it first.
 */
@Injectable()
export class AssignPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(childId: string, caller: AuthenticatedUser, dto: AssignPlanDto): Promise<PlanDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw this.forbidden();
      }
    }
    // ADMIN: no check. PARENT does not hold plan:manage.

    const template = await this.prisma.planTemplate.findUnique({
      where: { id: dto.planTemplateId },
      select: { id: true, status: true },
    });
    if (!template) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }
    if (template.status !== PlanTemplateStatus.PUBLISHED) {
      throw new ConflictException({
        code: 'PLAN_TEMPLATE_NOT_PUBLISHED',
        message: 'Only a published template can be assigned to a child.',
      });
    }

    const existingActive = await this.prisma.plan.findFirst({
      where: { childId, status: PlanStatus.ACTIVE },
      select: { id: true },
    });
    if (existingActive) {
      throw new ConflictException({
        code: 'PLAN_ALREADY_ACTIVE',
        message: 'This child already has an active plan — complete or archive it first.',
      });
    }

    let plan: Plan;
    try {
      plan = await this.prisma.$transaction(async (tx) => {
        const created = await tx.plan.create({
          data: {
            childId,
            planTemplateId: dto.planTemplateId,
            startDate: new Date(dto.startDate),
            createdById: caller.id,
          },
        });
        await snapshotTemplateIntoPlan(tx, dto.planTemplateId, created.id);
        return created;
      });
    } catch (error) {
      // The partial unique index plans_one_active_per_child is the real guard; the
      // pre-check above is only the friendly fast path.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'PLAN_ALREADY_ACTIVE',
          message: 'This child already has an active plan — complete or archive it first.',
        });
      }
      throw error;
    }
    return PlanDto.from(plan);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

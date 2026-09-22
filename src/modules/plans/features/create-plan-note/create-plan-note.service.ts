import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanNoteDto } from '@modules/plans/shared/plan-note.dto';
import { CreatePlanNoteDto } from './dto/create-plan-note.dto';

/**
 * CLINICIAN(assigned)/ADMIN leaves a note on a plan — append-only clinician-to-clinician
 * coordination, not visible to PARENT (§3 row 7 of plan 0006, docs/rbac.md decision
 * note). Scoping walks `PlanNote` → `Plan.childId`, same existence-check shape as
 * `plan:manage`.
 */
@Injectable()
export class CreatePlanNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    planId: string,
    caller: AuthenticatedUser,
    dto: CreatePlanNoteDto,
  ): Promise<PlanNoteDto> {
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
        throw this.forbidden();
      }
    }
    // ADMIN: no check. PARENT does not hold plan-note:create.

    const note = await this.prisma.planNote.create({
      data: { planId, authorId: caller.id, note: dto.note.trim() },
    });
    return PlanNoteDto.from(note);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

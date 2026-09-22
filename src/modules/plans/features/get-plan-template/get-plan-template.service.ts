import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanTemplateStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';

/**
 * `plan-template:read` for CLINICIAN is a query-filter shape, not an existence check
 * (docs/rbac.md) — a non-published template is `404`, not `403`: a clinician has no
 * business knowing a DRAFT/ARCHIVED template exists at all.
 */
@Injectable()
export class GetPlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string, caller: AuthenticatedUser): Promise<PlanTemplateDto> {
    const template = await this.prisma.planTemplate.findUnique({
      where: { id },
      include: { days: true },
    });
    if (
      !template ||
      (caller.role !== Role.ADMIN && template.status !== PlanTemplateStatus.PUBLISHED)
    ) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }
    return PlanTemplateDto.from(template);
  }
}

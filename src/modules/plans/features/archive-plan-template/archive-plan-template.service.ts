import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanTemplateStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { PLAN_TEMPLATE_INCLUDE, PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';

/**
 * Admin archives a plan template (C2, plan 0008). Valid from `DRAFT` or `PUBLISHED`;
 * idempotent if already `ARCHIVED` — same shape as `PublishPlanTemplateService`/
 * `ArchivePlanService`. No un-archive route — this is a terminal state, same
 * precedent as `PlanStatus.ARCHIVED`/`COMPLETED`.
 */
@Injectable()
export class ArchivePlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async archive(id: string): Promise<PlanTemplateDto> {
    const template = await this.prisma.planTemplate.findUnique({
      where: { id },
      include: PLAN_TEMPLATE_INCLUDE,
    });
    if (!template) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }
    if (template.status === PlanTemplateStatus.ARCHIVED) {
      return PlanTemplateDto.from(template);
    }

    const updated = await this.prisma.planTemplate.update({
      where: { id },
      data: { status: PlanTemplateStatus.ARCHIVED },
      include: PLAN_TEMPLATE_INCLUDE,
    });
    return PlanTemplateDto.from(updated);
  }
}

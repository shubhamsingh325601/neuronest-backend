import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanTemplateStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';

/**
 * Admin publishes a template — a one-way gate (no template versioning this phase;
 * editing a `PUBLISHED` template's days is not supported). Idempotent if already
 * `PUBLISHED`.
 */
@Injectable()
export class PublishPlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(id: string): Promise<PlanTemplateDto> {
    const template = await this.prisma.planTemplate.findUnique({
      where: { id },
      include: { days: true },
    });
    if (!template) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }
    if (template.status === PlanTemplateStatus.PUBLISHED) {
      return PlanTemplateDto.from(template);
    }

    const updated = await this.prisma.planTemplate.update({
      where: { id },
      data: { status: PlanTemplateStatus.PUBLISHED },
      include: { days: true },
    });
    return PlanTemplateDto.from(updated);
  }
}

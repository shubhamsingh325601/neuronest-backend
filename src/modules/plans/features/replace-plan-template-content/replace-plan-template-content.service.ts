import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanTemplateStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertValidContent } from '@modules/plans/shared/plan-content';
import { PLAN_TEMPLATE_INCLUDE, PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { writeTemplateContent } from '@modules/plans/shared/write-template-content';
import { ReplacePlanTemplateContentDto } from './dto/replace-plan-template-content.dto';

/**
 * Admin replaces a `DRAFT` template's sections and days atomically. Published/archived
 * templates are immutable (`409 PLAN_TEMPLATE_NOT_DRAFT`) so they stay trustworthy as
 * the provenance of already-assigned plans (plan 0016 §3 row 5).
 */
@Injectable()
export class ReplacePlanTemplateContentService {
  constructor(private readonly prisma: PrismaService) {}

  async replace(id: string, dto: ReplacePlanTemplateContentDto): Promise<PlanTemplateDto> {
    const template = await this.prisma.planTemplate.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!template) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }
    if (template.status !== PlanTemplateStatus.DRAFT) {
      throw new ConflictException({
        code: 'PLAN_TEMPLATE_NOT_DRAFT',
        message: 'Only a draft template can be edited; clone it to change a published one.',
      });
    }

    const sections = dto.sections ?? [];
    assertValidContent(sections, dto.days, { contiguous: true });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.planTemplateDay.deleteMany({ where: { planTemplateId: id } });
      await tx.planTemplateSection.deleteMany({ where: { planTemplateId: id } });
      await writeTemplateContent(tx, id, sections, dto.days);
      return tx.planTemplate.update({
        where: { id },
        data: { updatedAt: new Date() },
        include: PLAN_TEMPLATE_INCLUDE,
      });
    });
    return PlanTemplateDto.from(updated);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { PLAN_TEMPLATE_INCLUDE, PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { writeTemplateContent } from '@modules/plans/shared/write-template-content';

/**
 * Admin clones any template (any status) into a new `DRAFT` — the way to "edit" a
 * published template, which is immutable (plan 0016 §3 row 5).
 */
@Injectable()
export class ClonePlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async clone(id: string, adminId: string): Promise<PlanTemplateDto> {
    const source = await this.prisma.planTemplate.findUnique({
      where: { id },
      include: PLAN_TEMPLATE_INCLUDE,
    });
    if (!source) {
      throw new NotFoundException({
        code: 'PLAN_TEMPLATE_NOT_FOUND',
        message: 'No plan template with that id.',
      });
    }

    const sections = [...source.sections].sort((a, b) => a.position - b.position);
    const positionBySectionId = new Map(sections.map((s) => [s.id, s.position]));

    const cloned = await this.prisma.$transaction(async (tx) => {
      const created = await tx.planTemplate.create({
        data: {
          title: `${source.title} (copy)`.slice(0, 200),
          description: source.description,
          createdById: adminId,
        },
        select: { id: true },
      });
      await writeTemplateContent(
        tx,
        created.id,
        sections,
        source.days.map((day) => ({
          dayNumber: day.dayNumber,
          title: day.title,
          instructions: day.instructions,
          sectionPosition: day.sectionId ? positionBySectionId.get(day.sectionId) : undefined,
        })),
      );
      return tx.planTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: PLAN_TEMPLATE_INCLUDE,
      });
    });
    return PlanTemplateDto.from(cloned);
  }
}

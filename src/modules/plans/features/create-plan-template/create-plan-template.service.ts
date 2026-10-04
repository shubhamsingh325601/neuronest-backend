import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertValidContent } from '@modules/plans/shared/plan-content';
import { PLAN_TEMPLATE_INCLUDE, PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { writeTemplateContent } from '@modules/plans/shared/write-template-content';
import { CreatePlanTemplateDto } from './dto/create-plan-template.dto';

/**
 * Admin authors a reusable plan template with its sections and days, nested in one
 * request (§3 row 1 of plan 0006) — avoids N+1 admin-UI round trips for what is
 * fundamentally one authoring action. `dayNumber`s must form a contiguous `1..N` set
 * across `days[]`; checked here, not the DB, since it's a cross-row invariant a
 * single-row constraint can't express. Sections are optional (plan 0016).
 */
@Injectable()
export class CreatePlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createdById: string, dto: CreatePlanTemplateDto): Promise<PlanTemplateDto> {
    const sections = dto.sections ?? [];
    assertValidContent(sections, dto.days, { contiguous: true });

    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.planTemplate.create({
        data: {
          title: dto.title.trim(),
          description: dto.description?.trim(),
          createdById,
        },
        select: { id: true },
      });
      await writeTemplateContent(tx, created.id, sections, dto.days);
      return tx.planTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: PLAN_TEMPLATE_INCLUDE,
      });
    });
    return PlanTemplateDto.from(template);
  }
}

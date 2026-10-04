import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { loadEditablePlan } from '@modules/plans/shared/load-editable-plan';
import { PlanSectionDto } from '@modules/plans/shared/plan-template.dto';
import { ReplacePlanSectionsDto } from './dto/replace-plan-sections.dto';

/**
 * Replaces the section list of an `ACTIVE` plan. Entries carrying an existing `id` keep
 * that section (and the days attached to it); sections left out are deleted and their
 * days become section-less. Order = array order.
 */
@Injectable()
export class ReplacePlanSectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async replace(
    planId: string,
    caller: AuthenticatedUser,
    dto: ReplacePlanSectionsDto,
  ): Promise<PlanSectionDto[]> {
    await loadEditablePlan(this.prisma, planId, caller);

    const existing = await this.prisma.planSection.findMany({
      where: { planId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((s) => s.id));
    const keptIds = dto.sections.flatMap((s) => (s.id ? [s.id] : []));
    if (keptIds.some((id) => !existingIds.has(id)) || new Set(keptIds).size !== keptIds.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'sections[].id must be unique ids of sections that belong to this plan.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.planSection.deleteMany({ where: { planId, id: { notIn: keptIds } } });
      // Park kept sections on negative positions so reordering can't trip the unique key.
      for (const [i, id] of keptIds.entries()) {
        await tx.planSection.update({ where: { id }, data: { position: -(i + 1) } });
      }
      const result: PlanSectionDto[] = [];
      for (const [i, input] of dto.sections.entries()) {
        const data = { title: input.title.trim(), position: i + 1 };
        const row = input.id
          ? await tx.planSection.update({ where: { id: input.id }, data })
          : await tx.planSection.create({ data: { planId, ...data } });
        result.push(PlanSectionDto.from(row));
      }
      return result;
    });
  }
}

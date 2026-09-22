import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { CreatePlanTemplateDto } from './dto/create-plan-template.dto';

/**
 * Admin authors a reusable plan template with its days, nested in one request (§3 row
 * 1 of plan 0006) — avoids N+1 admin-UI round trips for what is fundamentally one
 * authoring action. `dayNumber`s must form a contiguous `1..N` set across `days[]`;
 * checked here, not the DB, since it's a cross-row invariant a single-row constraint
 * can't express.
 */
@Injectable()
export class CreatePlanTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createdById: string, dto: CreatePlanTemplateDto): Promise<PlanTemplateDto> {
    const dayNumbers = dto.days.map((day) => day.dayNumber).sort((a, b) => a - b);
    const isContiguous = dayNumbers.every((n, i) => n === i + 1);
    if (!isContiguous) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'days[].dayNumber must be a contiguous 1..N set.',
      });
    }

    const template = await this.prisma.planTemplate.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        createdById,
        days: {
          create: dto.days.map((day) => ({
            dayNumber: day.dayNumber,
            title: day.title.trim(),
            instructions: day.instructions.trim(),
          })),
        },
      },
      include: { days: true },
    });
    return PlanTemplateDto.from(template);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Plan, PlanDay, PlanOrigin, PlanSection, PlanStatus, Role } from '@prisma/client';
import { PlanSectionDto } from './plan-template.dto';

/** Who is reading — `PARENT` gets the redacted shape; omitted means the full shape. */
export interface PlanAudience {
  audience?: Role;
}

/** Full representation of a plan, as returned to the child's own parent, an assigned clinician, or admin. */
export class PlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  childId!: string;

  @ApiProperty()
  planTemplateId!: string;

  @ApiProperty({ enum: PlanStatus })
  status!: PlanStatus;

  @ApiProperty({ enum: PlanOrigin })
  origin!: PlanOrigin;

  @ApiProperty({ type: String, format: 'date' })
  startDate!: Date;

  @ApiPropertyOptional({ description: 'Omitted for the PARENT audience.' })
  createdById?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: Plan, { audience }: PlanAudience = {}): PlanDto {
    const dto: PlanDto = {
      id: row.id,
      childId: row.childId,
      planTemplateId: row.planTemplateId,
      status: row.status,
      origin: row.origin,
      startDate: row.startDate,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    // Parents see what their child's plan is, not which staff member authored it.
    if (audience === Role.PARENT) {
      delete dto.createdById;
    }
    return dto;
  }
}

/** One day of a plan's own (snapshotted, per-child editable) content. */
export class PlanDayDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  dayNumber!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  instructions!: string;

  @ApiProperty({ type: String, nullable: true })
  sectionId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: PlanDay): PlanDayDto {
    return {
      id: row.id,
      dayNumber: row.dayNumber,
      title: row.title,
      instructions: row.instructions,
      sectionId: row.sectionId ?? null,
      updatedAt: row.updatedAt,
    };
  }
}

/** A plan plus its own content: `days[]` ordered by `dayNumber`, `sections[]` by `position`. */
export class PlanDetailDto extends PlanDto {
  @ApiProperty({ type: [PlanDayDto] })
  days!: PlanDayDto[];

  @ApiProperty({ type: [PlanSectionDto] })
  sections!: PlanSectionDto[];

  static fromWithContent(
    row: Plan & { days: PlanDay[]; sections: PlanSection[] },
    options: PlanAudience = {},
  ): PlanDetailDto {
    return {
      ...PlanDto.from(row, options),
      days: [...row.days].sort((a, b) => a.dayNumber - b.dayNumber).map(PlanDayDto.from),
      sections: [...row.sections].sort((a, b) => a.position - b.position).map(PlanSectionDto.from),
    };
  }
}

/** Standard include for a plan's own content. */
export const PLAN_CONTENT_INCLUDE = { days: true, sections: true } as const;

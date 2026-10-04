import { ApiProperty } from '@nestjs/swagger';
import {
  Prisma,
  PlanTemplate,
  PlanTemplateDay,
  PlanTemplateSection,
  PlanTemplateStatus,
} from '@prisma/client';

/** Standard include for every read that returns a `PlanTemplateDto`. */
export const PLAN_TEMPLATE_INCLUDE = {
  days: true,
  sections: true,
} satisfies Prisma.PlanTemplateInclude;

/** Full representation of a plan template day. */
export class PlanTemplateDayDto {
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

  static from(row: PlanTemplateDay): PlanTemplateDayDto {
    return {
      id: row.id,
      sectionId: row.sectionId ?? null,
      dayNumber: row.dayNumber,
      title: row.title,
      instructions: row.instructions,
    };
  }
}

/** A named group of days within a template (or plan); `position` is 1-based. */
export class PlanSectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  position!: number;

  static from(row: { id: string; title: string; position: number }): PlanSectionDto {
    return { id: row.id, title: row.title, position: row.position };
  }
}

type PlanTemplateWithDays = PlanTemplate & {
  days: PlanTemplateDay[];
  sections?: PlanTemplateSection[];
};

/** Full representation of a plan template, as returned to admin (any status) or a clinician (published only). */
export class PlanTemplateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: PlanTemplateStatus })
  status!: PlanTemplateStatus;

  @ApiProperty()
  createdById!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: [PlanTemplateDayDto] })
  days!: PlanTemplateDayDto[];

  @ApiProperty({ type: [PlanSectionDto] })
  sections!: PlanSectionDto[];

  static from(row: PlanTemplateWithDays): PlanTemplateDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      days: [...row.days].sort((a, b) => a.dayNumber - b.dayNumber).map(PlanTemplateDayDto.from),
      sections: [...(row.sections ?? [])]
        .sort((a, b) => a.position - b.position)
        .map(PlanSectionDto.from),
    };
  }
}

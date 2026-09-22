import { ApiProperty } from '@nestjs/swagger';
import { PlanTemplate, PlanTemplateDay, PlanTemplateStatus } from '@prisma/client';

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

  static from(row: PlanTemplateDay): PlanTemplateDayDto {
    return {
      id: row.id,
      dayNumber: row.dayNumber,
      title: row.title,
      instructions: row.instructions,
    };
  }
}

type PlanTemplateWithDays = PlanTemplate & { days: PlanTemplateDay[] };

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

  static from(row: PlanTemplateWithDays): PlanTemplateDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      days: [...row.days]
        .sort((a, b) => a.dayNumber - b.dayNumber)
        .map(PlanTemplateDayDto.from),
    };
  }
}

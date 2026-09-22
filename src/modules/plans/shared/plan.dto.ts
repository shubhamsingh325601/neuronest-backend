import { ApiProperty } from '@nestjs/swagger';
import { Plan, PlanOrigin, PlanStatus } from '@prisma/client';

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

  @ApiProperty()
  createdById!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: Plan): PlanDto {
    return {
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
  }
}

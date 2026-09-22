import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class AssignPlanDto {
  @ApiProperty({ description: 'Id of a PUBLISHED PlanTemplate.' })
  @IsUUID()
  planTemplateId!: string;

  @ApiProperty({ example: '2026-09-22', description: 'ISO 8601 date, no time component.' })
  @IsDateString()
  startDate!: string;
}

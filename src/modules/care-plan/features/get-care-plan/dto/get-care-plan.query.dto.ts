import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetCarePlanQueryDto {
  @ApiPropertyOptional({
    example: 330,
    description:
      "Minutes the caller's local time is ahead of UTC (e.g. 330 for India). Decides which calendar day it is for the plan; defaults to UTC.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffsetMinutes?: number;
}
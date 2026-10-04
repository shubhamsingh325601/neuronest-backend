import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class ListCoachingQueryDto {
  @ApiPropertyOptional({
    example: 'current',
    description: '`current` (default) or a 1-based week number of the active plan.',
  })
  @IsOptional()
  @Matches(/^(current|[1-9]\d{0,3})$/, { message: 'week must be "current" or a week number.' })
  week?: string;
}

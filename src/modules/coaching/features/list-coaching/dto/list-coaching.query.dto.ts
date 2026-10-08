import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListCoachingQueryDto {
  @ApiPropertyOptional({
    example: 'current',
    description: '`current` (default) or a 1-based week number of the active plan.',
  })
  @IsOptional()
  @Matches(/^(current|[1-9]\d{0,3})$/, { message: 'week must be "current" or a week number.' })
  week?: string;

  @ApiPropertyOptional({
    example: 330,
    description: 'Minutes the caller\'s local time is ahead of UTC; decides which day the current week is resolved on.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffsetMinutes?: number;
}

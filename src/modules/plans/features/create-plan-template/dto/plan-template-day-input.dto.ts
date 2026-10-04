import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class PlanTemplateDayInputDto {
  @ApiProperty({
    minimum: 1,
    maximum: 365,
    description: 'Templates require a contiguous 1..N set across the whole days[] array.',
  })
  @IsInt()
  @Min(1)
  @Max(365)
  dayNumber!: number;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  instructions!: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      '1-based position of a section in the sibling sections[] array this day belongs to.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  sectionPosition?: number;
}

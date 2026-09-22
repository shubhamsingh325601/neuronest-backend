import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class PlanTemplateDayInputDto {
  @ApiProperty({ minimum: 1, description: 'Must form a contiguous 1..N set across the whole days[] array.' })
  @IsInt()
  @Min(1)
  dayNumber!: number;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  instructions!: string;
}

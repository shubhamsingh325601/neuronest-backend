import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class SetSummaryDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  summary!: string;

  @ApiProperty({ type: [String], maxItems: 10, description: 'What was agreed, one line each.' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  actionPoints!: string[];
}
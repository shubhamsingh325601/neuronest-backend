import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CoachingTipInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Why this matters for the child.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whyItMatters?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 8, description: 'Short steps, in order.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(300, { each: true })
  steps?: string[];

  @ApiPropertyOptional({ maxLength: 300, description: 'Something the parent can say.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  scriptQuote?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'When to say it.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  scriptContext?: string;
}

export class ReplaceCoachingDto {
  @ApiProperty({
    type: [CoachingTipInputDto],
    maxItems: 5,
    description: 'The full tip set for the week, in display order. An empty array clears the week.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CoachingTipInputDto)
  tips!: CoachingTipInputDto[];
}

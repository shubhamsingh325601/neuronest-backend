import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlanSectionInputDto {
  @ApiPropertyOptional({
    description: 'Existing section id to keep (and retitle/reorder); omit to create a new one.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}

export class ReplacePlanSectionsDto {
  @ApiProperty({ type: [PlanSectionInputDto], description: 'Position is the 1-based array index.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanSectionInputDto)
  sections!: PlanSectionInputDto[];
}

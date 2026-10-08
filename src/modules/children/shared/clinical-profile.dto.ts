import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const SENSITIVITY_LEVELS = ['HIGH', 'MODERATE', 'SEEKING'] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

export class ChildStrengthDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  title!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  description!: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Icon token the client maps to a glyph.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

export class SensoryTraitDto {
  @ApiProperty({ example: 'Auditory', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  domain!: string;

  @ApiProperty({ enum: SENSITIVITY_LEVELS })
  @IsIn(SENSITIVITY_LEVELS)
  sensitivityLevel!: SensitivityLevel;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  triggers!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  accommodations!: string[];

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;
}

export class CalmingPreferenceDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  title!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  technique!: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  effectiveness?: string;
}

export class CommunicationProfileDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  expressiveMode!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  receptiveUnderstanding!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  preferredPrompts!: string[];
}

/** Clinician-authored profile content. The whole object is replaced on each `PUT`. */
export class ClinicalProfileDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  currentStage?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observationSummary?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  primaryCareFocus?: string;

  @ApiProperty({ type: [ChildStrengthDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ChildStrengthDto)
  strengths!: ChildStrengthDto[];

  @ApiProperty({ type: [SensoryTraitDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => SensoryTraitDto)
  sensoryTraits!: SensoryTraitDto[];

  @ApiProperty({ type: [CalmingPreferenceDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CalmingPreferenceDto)
  calmingPreferences!: CalmingPreferenceDto[];

  @ApiPropertyOptional({ type: CommunicationProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommunicationProfileDto)
  communication?: CommunicationProfileDto;
}

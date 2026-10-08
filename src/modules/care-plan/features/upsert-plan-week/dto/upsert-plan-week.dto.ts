import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MAX_PLAN_WEEKS = 12;
export const MAX_GOALS_PER_WEEK = 6;
export const MAX_ACTIVITIES_PER_WEEK = 14;
export const MAX_STEPS_PER_ACTIVITY = 10;

export class ActivityStepInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  instruction!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  tip?: string;
}

export class ParentScriptInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  scriptQuote!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  tip!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  context?: string;
}

export class WeekGuidanceInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  scriptSnippet!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  practicalTip!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  context!: string;
}

export class PlanGoalInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MaxLength(400)
  description!: string;

  @ApiProperty({ example: 'Language', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  domain!: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Icon token the client maps to a glyph.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;
}

export class PlanActivityInputDto {
  @ApiProperty({
    minimum: 1,
    maximum: 7,
    description: 'Day of the plan week (1 = first day of the week).',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  shortDescription!: string;

  @ApiProperty({ example: 'Language Goal', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  goalCategory!: string;

  @ApiProperty({ example: 'Expressive Communication', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  domain!: string;

  @ApiProperty({ minimum: 1, maximum: 240 })
  @IsInt()
  @Min(1)
  @Max(240)
  durationMinutes!: number;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  whyItMatters!: string;

  @ApiProperty({ type: [ActivityStepInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STEPS_PER_ACTIVITY)
  @ValidateNested({ each: true })
  @Type(() => ActivityStepInputDto)
  steps!: ActivityStepInputDto[];

  @ApiPropertyOptional({ type: ParentScriptInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ParentScriptInputDto)
  parentScript?: ParentScriptInputDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  equipment?: string[];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  clinicalReassurance?: string;
}

/** PUT body: the week becomes exactly this content (positions follow array order). */
export class UpsertPlanWeekDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 200, description: 'Short focus line shown under the week title.' })
  @IsString()
  @MaxLength(200)
  focus!: string;

  @ApiPropertyOptional({ type: WeekGuidanceInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeekGuidanceInputDto)
  guidance?: WeekGuidanceInputDto;

  @ApiProperty({ type: [PlanGoalInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_GOALS_PER_WEEK)
  @ValidateNested({ each: true })
  @Type(() => PlanGoalInputDto)
  goals!: PlanGoalInputDto[];

  @ApiProperty({ type: [PlanActivityInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ACTIVITIES_PER_WEEK)
  @ValidateNested({ each: true })
  @Type(() => PlanActivityInputDto)
  activities!: PlanActivityInputDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { PlanTemplateDayInputDto } from '@modules/plans/features/create-plan-template/dto/plan-template-day-input.dto';
import { PlanTemplateSectionInputDto } from '@modules/plans/features/create-plan-template/dto/plan-template-section-input.dto';

export class ReplacePlanTemplateContentDto {
  @ApiProperty({ type: [PlanTemplateDayInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanTemplateDayInputDto)
  days!: PlanTemplateDayInputDto[];

  @ApiPropertyOptional({ type: [PlanTemplateSectionInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanTemplateSectionInputDto)
  sections?: PlanTemplateSectionInputDto[];
}

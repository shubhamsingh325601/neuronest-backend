import { ApiProperty } from '@nestjs/swagger';
import { PlanTemplateDayDto } from '@modules/plans/shared/plan-template.dto';
import { PlanDto } from '@modules/plans/shared/plan.dto';

export class TodayFocusResponseDto {
  @ApiProperty({ type: PlanDto })
  plan!: PlanDto;

  @ApiProperty({
    type: PlanTemplateDayDto,
    nullable: true,
    description:
      "Null when today's computed day offset falls outside the template's day range — a valid, displayable state, not an error.",
  })
  day!: PlanTemplateDayDto | null;
}

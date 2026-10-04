import { ApiProperty } from '@nestjs/swagger';
import { PlanDayDto, PlanDto } from '@modules/plans/shared/plan.dto';

export class TodayFocusResponseDto {
  @ApiProperty({ type: PlanDto })
  plan!: PlanDto;

  @ApiProperty({
    type: PlanDayDto,
    nullable: true,
    description:
      "Null when today's computed day offset falls outside the plan's day range — a valid, displayable state, not an error.",
  })
  day!: PlanDayDto | null;
}

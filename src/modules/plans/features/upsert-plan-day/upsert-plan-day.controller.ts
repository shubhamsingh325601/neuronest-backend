import { Body, Controller, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { assertDayNumber } from '@modules/plans/shared/day-number';
import { PlanDayDto } from '@modules/plans/shared/plan.dto';
import { UpsertPlanDayDto } from './dto/upsert-plan-day.dto';
import { UpsertPlanDayService } from './upsert-plan-day.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class UpsertPlanDayController {
  constructor(private readonly upsertPlanDayService: UpsertPlanDayService) {}

  @Put(':id/days/:dayNumber')
  @Auth('plan:manage')
  @ApiOkResponse({ type: PlanDayDto })
  @ApiOperation({
    operationId: 'planDayUpsert',
    summary: 'CLINICIAN(assigned)/ADMIN: create or rewrite one day (1..365) of an ACTIVE plan.',
  })
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayNumber', ParseIntPipe) dayNumber: number,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpsertPlanDayDto,
  ): Promise<PlanDayDto> {
    return this.upsertPlanDayService.upsert(id, assertDayNumber(dayNumber), caller, dto);
  }
}

import { Body, Controller, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CarePlanWeekDto } from '@modules/care-plan/shared/care-plan.dto';
import { UpsertPlanWeekDto } from './dto/upsert-plan-week.dto';
import { UpsertPlanWeekService } from './upsert-plan-week.service';

@ApiTags('care-plan')
@Controller({ path: 'plans', version: '1' })
export class UpsertPlanWeekController {
  constructor(private readonly upsertPlanWeekService: UpsertPlanWeekService) {}

  @Put(':id/weeks/:weekNumber')
  @Auth('plan:manage')
  @ApiOkResponse({ type: CarePlanWeekDto })
  @ApiOperation({
    operationId: 'planWeekUpsert',
    summary:
      'CLINICIAN(assigned)/ADMIN: replace one week (1..12) of an ACTIVE plan: focus, guidance, goals and activities.',
  })
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('weekNumber', ParseIntPipe) weekNumber: number,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpsertPlanWeekDto,
  ): Promise<CarePlanWeekDto> {
    return this.upsertPlanWeekService.upsert(id, weekNumber, caller, dto);
  }
}

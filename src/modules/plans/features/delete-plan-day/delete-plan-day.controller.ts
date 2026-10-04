import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { assertDayNumber } from '@modules/plans/shared/day-number';
import { DeletePlanDayService } from './delete-plan-day.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class DeletePlanDayController {
  constructor(private readonly deletePlanDayService: DeletePlanDayService) {}

  @Delete(':id/days/:dayNumber')
  @Auth('plan:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiOperation({
    operationId: 'planDayDelete',
    summary: 'CLINICIAN(assigned)/ADMIN: remove one day of an ACTIVE plan — idempotent 204.',
  })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayNumber', ParseIntPipe) dayNumber: number,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<void> {
    return this.deletePlanDayService.delete(id, assertDayNumber(dayNumber), caller);
  }
}

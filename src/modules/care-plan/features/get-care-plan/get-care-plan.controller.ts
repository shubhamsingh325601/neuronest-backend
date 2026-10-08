import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CarePlanDto } from '@modules/care-plan/shared/care-plan.dto';
import { GetCarePlanQueryDto } from './dto/get-care-plan.query.dto';
import { GetCarePlanService } from './get-care-plan.service';

@ApiTags('care-plan')
@Controller({ path: 'children', version: '1' })
export class GetCarePlanController {
  constructor(private readonly getCarePlanService: GetCarePlanService) {}

  @Get(':childId/care-plan')
  @Auth('plan:read')
  @ApiOkResponse({ type: CarePlanDto })
  @ApiOperation({
    operationId: 'carePlanGet',
    summary:
      "The child's ACTIVE plan as the app shows it: weeks, goals, scheduled activities and completion state (parent-own / clinician-assigned / admin).",
  })
  get(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: GetCarePlanQueryDto,
  ): Promise<CarePlanDto> {
    return this.getCarePlanService.get(childId, caller, new Date(), query.tzOffsetMinutes);
  }
}

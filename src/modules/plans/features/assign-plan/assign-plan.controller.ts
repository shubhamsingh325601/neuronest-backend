import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { AssignPlanDto } from './dto/assign-plan.dto';
import { AssignPlanService } from './assign-plan.service';

@ApiTags('plans')
@Controller({ path: 'children', version: '1' })
export class AssignPlanController {
  constructor(private readonly assignPlanService: AssignPlanService) {}

  @Post(':childId/plans')
  @Auth('plan:manage')
  @ApiCreatedResponse({ type: PlanDto })
  @ApiOperation({
    operationId: 'planAssign',
    summary: 'CLINICIAN(assigned)/ADMIN: assign a published template to a child as a new active plan.',
  })
  assign(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: AssignPlanDto,
  ): Promise<PlanDto> {
    return this.assignPlanService.assign(childId, caller, dto);
  }
}

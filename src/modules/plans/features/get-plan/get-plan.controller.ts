import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { GetPlanService } from './get-plan.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class GetPlanController {
  constructor(private readonly getPlanService: GetPlanService) {}

  @Get(':id')
  @Auth('plan:read')
  @ApiOkResponse({ type: PlanDto })
  @ApiOperation({
    operationId: 'planGet',
    summary: "Read a single plan by id — the child's own parent, an assigned clinician, or admin.",
  })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<PlanDto> {
    return this.getPlanService.getById(id, caller);
  }
}

import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { CompletePlanService } from './complete-plan.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class CompletePlanController {
  constructor(private readonly completePlanService: CompletePlanService) {}

  @Post(':id/complete')
  @Auth('plan:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlanDto })
  @ApiOperation({
    operationId: 'planComplete',
    summary: 'CLINICIAN(assigned)/ADMIN: complete a plan — idempotent, 409 if already archived.',
  })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<PlanDto> {
    return this.completePlanService.complete(id, caller);
  }
}

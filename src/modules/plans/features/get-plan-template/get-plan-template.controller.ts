import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { GetPlanTemplateService } from './get-plan-template.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class GetPlanTemplateController {
  constructor(private readonly getPlanTemplateService: GetPlanTemplateService) {}

  @Get(':id')
  @Auth('plan-template:read')
  @ApiOkResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplateGet',
    summary: 'Read a plan template — CLINICIAN only if published, ADMIN any status.',
  })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<PlanTemplateDto> {
    return this.getPlanTemplateService.getById(id, caller);
  }
}

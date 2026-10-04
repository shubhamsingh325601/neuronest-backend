import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { ClonePlanTemplateService } from './clone-plan-template.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class ClonePlanTemplateController {
  constructor(private readonly clonePlanTemplateService: ClonePlanTemplateService) {}

  @Post(':id/clone')
  @Auth('plan-template:manage')
  @ApiCreatedResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplateClone',
    summary:
      'Admin: clone a plan template (any status) into a new DRAFT, sections and days included.',
  })
  clone(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<PlanTemplateDto> {
    return this.clonePlanTemplateService.clone(id, adminId);
  }
}

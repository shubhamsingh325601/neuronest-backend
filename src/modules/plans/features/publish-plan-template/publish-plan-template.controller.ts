import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { PublishPlanTemplateService } from './publish-plan-template.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class PublishPlanTemplateController {
  constructor(private readonly publishPlanTemplateService: PublishPlanTemplateService) {}

  @Post(':id/publish')
  @Auth('plan-template:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplatePublish',
    summary: 'Admin: publish a plan template — a one-way gate, idempotent if already published.',
  })
  publish(@Param('id', ParseUUIDPipe) id: string): Promise<PlanTemplateDto> {
    return this.publishPlanTemplateService.publish(id);
  }
}

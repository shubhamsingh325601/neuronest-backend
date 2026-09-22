import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { CreatePlanTemplateDto } from './dto/create-plan-template.dto';
import { CreatePlanTemplateService } from './create-plan-template.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class CreatePlanTemplateController {
  constructor(private readonly createPlanTemplateService: CreatePlanTemplateService) {}

  @Post()
  @Auth('plan-template:manage')
  @ApiCreatedResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplateCreate',
    summary: 'Admin: create a plan template with its days, nested in one request.',
  })
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreatePlanTemplateDto,
  ): Promise<PlanTemplateDto> {
    return this.createPlanTemplateService.create(adminId, dto);
  }
}

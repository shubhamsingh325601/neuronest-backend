import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { ReplacePlanTemplateContentDto } from './dto/replace-plan-template-content.dto';
import { ReplacePlanTemplateContentService } from './replace-plan-template-content.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class ReplacePlanTemplateContentController {
  constructor(
    private readonly replacePlanTemplateContentService: ReplacePlanTemplateContentService,
  ) {}

  @Put(':id/content')
  @Auth('plan-template:manage')
  @ApiOkResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplateContentReplace',
    summary: "Admin: atomically replace a DRAFT template's sections and days (409 if not a draft).",
  })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePlanTemplateContentDto,
  ): Promise<PlanTemplateDto> {
    return this.replacePlanTemplateContentService.replace(id, dto);
  }
}

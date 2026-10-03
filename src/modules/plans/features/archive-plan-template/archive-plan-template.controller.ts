import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { ArchivePlanTemplateService } from './archive-plan-template.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class ArchivePlanTemplateController {
  constructor(private readonly archivePlanTemplateService: ArchivePlanTemplateService) {}

  @Post(':id/archive')
  @Auth('plan-template:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlanTemplateDto })
  @ApiOperation({
    operationId: 'planTemplateArchive',
    summary: 'Admin: archive a plan template — a terminal state, idempotent if already archived.',
  })
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<PlanTemplateDto> {
    return this.archivePlanTemplateService.archive(id);
  }
}

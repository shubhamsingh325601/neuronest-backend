import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListPlanTemplatesQueryDto } from './dto/list-plan-templates.query.dto';
import { ListPlanTemplatesResponseDto } from './dto/list-plan-templates.response.dto';
import { ListPlanTemplatesService } from './list-plan-templates.service';

@ApiTags('plans')
@Controller({ path: 'plan-templates', version: '1' })
export class ListPlanTemplatesController {
  constructor(private readonly listPlanTemplatesService: ListPlanTemplatesService) {}

  @Get()
  @Auth('plan-template:read')
  @ApiOkResponse({ type: ListPlanTemplatesResponseDto })
  @ApiOperation({
    operationId: 'planTemplateList',
    summary:
      'Cursor-paginated plan template library — CLINICIAN sees published templates only, ADMIN sees all.',
  })
  list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListPlanTemplatesQueryDto,
  ): Promise<ListPlanTemplatesResponseDto> {
    return this.listPlanTemplatesService.list(caller, query);
  }
}

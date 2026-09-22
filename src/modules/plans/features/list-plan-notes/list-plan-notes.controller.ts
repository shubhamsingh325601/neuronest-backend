import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListPlanNotesQueryDto } from './dto/list-plan-notes.query.dto';
import { ListPlanNotesResponseDto } from './dto/list-plan-notes.response.dto';
import { ListPlanNotesService } from './list-plan-notes.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class ListPlanNotesController {
  constructor(private readonly listPlanNotesService: ListPlanNotesService) {}

  @Get(':id/notes')
  @Auth('plan-note:read')
  @ApiOkResponse({ type: ListPlanNotesResponseDto })
  @ApiOperation({
    operationId: 'planNoteList',
    summary:
      "CLINICIAN(assigned)/ADMIN: cursor-paginated notes on a plan, oldest-first — not visible to PARENT.",
  })
  list(
    @Param('id', ParseUUIDPipe) planId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListPlanNotesQueryDto,
  ): Promise<ListPlanNotesResponseDto> {
    return this.listPlanNotesService.list(planId, caller, query);
  }
}

import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { EscalationPageDto } from '@modules/escalations/shared/escalation.dto';
import { ListChildEscalationsService } from './list-child-escalations.service';

@ApiTags('escalations')
@Controller({ path: 'children', version: '1' })
export class ListChildEscalationsController {
  constructor(private readonly listChildEscalationsService: ListChildEscalationsService) {}

  @Get(':childId/escalations')
  @Auth('escalation:read')
  @ApiOkResponse({ type: EscalationPageDto })
  @ApiOperation({
    operationId: 'escalationListForChild',
    summary:
      'Cursor-paginated urgent-support history for a child, newest first (parent-own / clinician-assigned / admin).',
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: CursorPaginationQueryDto,
  ): Promise<EscalationPageDto> {
    return this.listChildEscalationsService.list(childId, caller, query);
  }
}

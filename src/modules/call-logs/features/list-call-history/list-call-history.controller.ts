import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListCallHistoryQueryDto } from './dto/list-call-history.query.dto';
import { ListCallHistoryResponseDto } from './dto/list-call-history.response.dto';
import { ListCallHistoryService } from './list-call-history.service';

@ApiTags('call-logs')
@Controller({ path: 'children', version: '1' })
export class ListCallHistoryController {
  constructor(private readonly listCallHistoryService: ListCallHistoryService) {}

  @Get(':childId/call-logs')
  @Auth('monthly-call:read')
  @ApiOkResponse({ type: ListCallHistoryResponseDto })
  @ApiOperation({
    operationId: 'monthlyCallLogList',
    summary:
      "CLINICIAN(assigned)/ADMIN: cursor-paginated call history for a child, newest-first — not visible to PARENT.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListCallHistoryQueryDto,
  ): Promise<ListCallHistoryResponseDto> {
    return this.listCallHistoryService.list(childId, caller, query);
  }
}

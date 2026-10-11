import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { ListConversationsResponseDto } from './dto/list-conversations.response.dto';
import { ListConversationsService } from './list-conversations.service';

@ApiTags('conversations')
@Controller({ path: 'children', version: '1' })
export class ListConversationsController {
  constructor(private readonly listConversationsService: ListConversationsService) {}

  @Get(':childId/conversations')
  @Auth('conversation:read')
  @ApiOkResponse({ type: ListConversationsResponseDto })
  @ApiOperation({
    operationId: 'conversationList',
    summary: "Participant: a child's chat sessions with their summary status. Never message text.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Query() query: CursorPaginationQueryDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ListConversationsResponseDto> {
    return this.listConversationsService.list(childId, query, caller);
  }
}

import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { ListConversationSummariesResponseDto } from './dto/list-conversation-summaries.response.dto';
import { ListConversationSummariesService } from './list-conversation-summaries.service';

@ApiTags('conversations')
@Controller({ path: 'children', version: '1' })
export class ListConversationSummariesController {
  constructor(
    private readonly listConversationSummariesService: ListConversationSummariesService,
  ) {}

  @Get(':childId/conversation-summaries')
  @Auth('conversation-summary:read')
  @ApiOkResponse({ type: ListConversationSummariesResponseDto })
  @ApiOperation({
    operationId: 'conversationSummaryList',
    summary:
      "Parent (own child), an assigned clinician, the child's expert (own chats) or admin: a child's chat summaries.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Query() query: CursorPaginationQueryDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ListConversationSummariesResponseDto> {
    return this.listConversationSummariesService.list(childId, query, caller);
  }
}

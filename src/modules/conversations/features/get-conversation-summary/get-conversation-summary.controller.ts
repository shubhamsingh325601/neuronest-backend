import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationSummaryDto } from '@modules/conversations/shared/conversation-summary.dto';
import { GetConversationSummaryService } from './get-conversation-summary.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class GetConversationSummaryController {
  constructor(private readonly getConversationSummaryService: GetConversationSummaryService) {}

  @Get(':id/summary')
  @Auth('conversation-summary:read')
  @ApiOkResponse({ type: ConversationSummaryDto })
  @ApiOperation({
    operationId: 'conversationSummaryGet',
    summary:
      "Parent (own), the conversation's expert, an assigned clinician or admin: the summary of a closed chat.",
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConversationSummaryDto> {
    return this.getConversationSummaryService.get(id, caller);
  }
}

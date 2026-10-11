import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { CloseConversationService } from './close-conversation.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class CloseConversationController {
  constructor(private readonly closeConversationService: CloseConversationService) {}

  @Post(':id/close')
  @HttpCode(200)
  @Auth('conversation:close')
  @ApiOkResponse({ type: ConversationDto })
  @ApiOperation({
    operationId: 'conversationClose',
    summary: 'Participant: end the session. Closing a closed conversation changes nothing.',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConversationDto> {
    return this.closeConversationService.close(id, caller);
  }
}

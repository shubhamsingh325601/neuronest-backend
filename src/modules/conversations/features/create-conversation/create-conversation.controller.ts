import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { CreateConversationService } from './create-conversation.service';

@ApiTags('conversations')
@Controller({ path: 'children', version: '1' })
export class CreateConversationController {
  constructor(private readonly createConversationService: CreateConversationService) {}

  @Post(':childId/conversations')
  @Auth('conversation:create:self')
  @ApiCreatedResponse({ type: ConversationDto })
  @ApiOperation({
    operationId: 'conversationCreate',
    summary: "Parent: start a chat session with the child's assigned expert.",
  })
  create(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConversationDto> {
    return this.createConversationService.create(childId, caller);
  }
}

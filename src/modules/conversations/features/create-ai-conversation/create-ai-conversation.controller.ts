import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { CreateAiConversationService } from './create-ai-conversation.service';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';

@ApiTags('ai-chat')
@Controller({ path: 'children', version: '1' })
export class CreateAiConversationController {
  constructor(private readonly createAiConversationService: CreateAiConversationService) {}

  @Post(':childId/ai-conversations')
  @Auth('ai-chat:send:self')
  @ApiCreatedResponse({ type: ConversationDto })
  @ApiOperation({
    operationId: 'aiConversationCreate',
    summary:
      'Parent (own child): start an AI chat on one guided topic. 422 for a topic that is not an AI chat.',
  })
  create(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: CreateAiConversationDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConversationDto> {
    return this.createAiConversationService.create(childId, dto, caller);
  }
}

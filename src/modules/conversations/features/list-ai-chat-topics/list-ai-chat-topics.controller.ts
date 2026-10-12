import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListAiChatTopicsResponseDto } from './dto/list-ai-chat-topics.response.dto';
import { ListAiChatTopicsService } from './list-ai-chat-topics.service';

@ApiTags('ai-chat')
@Controller({ path: 'ai-chat', version: '1' })
export class ListAiChatTopicsController {
  constructor(private readonly listAiChatTopicsService: ListAiChatTopicsService) {}

  @Get('topics')
  @Auth('ai-chat:send:self')
  @ApiOkResponse({ type: ListAiChatTopicsResponseDto })
  @ApiOperation({
    operationId: 'aiChatTopicList',
    summary:
      'Parent: the guided topics for the AI chat menu, from the server so the app never hard-codes them.',
  })
  list(@CurrentUser() caller: AuthenticatedUser): ListAiChatTopicsResponseDto {
    return this.listAiChatTopicsService.list(caller);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListMyConversationsResponseDto } from './dto/list-my-conversations.response.dto';
import { ListMyConversationsService } from './list-my-conversations.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class ListMyConversationsController {
  constructor(private readonly listMyConversationsService: ListMyConversationsService) {}

  @Get('mine')
  @Auth('conversation:read')
  @ApiOkResponse({ type: ListMyConversationsResponseDto })
  @ApiOperation({
    operationId: 'conversationListMine',
    summary: "EXPERT: every chat they take part in, with the child's name and most-recent activity.",
  })
  list(@CurrentUser() caller: AuthenticatedUser): Promise<ListMyConversationsResponseDto> {
    return this.listMyConversationsService.list(caller);
  }
}

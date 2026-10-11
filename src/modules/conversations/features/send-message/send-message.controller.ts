import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { MessageDto } from '@modules/conversations/shared/conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMessageService } from './send-message.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class SendMessageController {
  constructor(private readonly sendMessageService: SendMessageService) {}

  @Post(':id/messages')
  @Auth('message:send')
  @ApiCreatedResponse({ type: MessageDto })
  @ApiOperation({
    operationId: 'messageSend',
    summary: 'Parent or the conversation expert: send a message. Idempotent on clientMessageId.',
  })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<MessageDto> {
    return this.sendMessageService.send(id, dto, caller);
  }
}

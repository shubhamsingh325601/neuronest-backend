import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';
import { ListMessagesResponseDto } from './dto/list-messages.response.dto';
import { ListMessagesService } from './list-messages.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class ListMessagesController {
  constructor(private readonly listMessagesService: ListMessagesService) {}

  @Get(':id/messages')
  @Auth('conversation:read')
  @ApiOkResponse({ type: ListMessagesResponseDto })
  @ApiOperation({
    operationId: 'messageList',
    summary: 'Participant: read messages after a seq, oldest first.',
  })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ListMessagesResponseDto> {
    return this.listMessagesService.list(id, query, caller);
  }
}

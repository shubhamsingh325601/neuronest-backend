import {
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationEventsGuard } from './conversation-events.guard';
import { ConversationEventsService } from './conversation-events.service';

@ApiTags('conversations')
@Controller({ path: 'conversations', version: '1' })
export class ConversationEventsController {
  constructor(private readonly conversationEventsService: ConversationEventsService) {}

  @Sse(':id/events')
  @Auth('conversation:read')
  @UseGuards(ConversationEventsGuard)
  @ApiOkResponse({
    description:
      'A `text/event-stream` for a chat with an expert, for its two participants. Events (the SSE `id` is a message seq, send it back as `Last-Event-ID` to resume): `message` (the same object as `GET .../messages` items), `resync` {lastSeq} (too much was missed to replay: read `GET .../messages?afterSeq=` up to `lastSeq`; live events continue after it), `closed` (the conversation object; the stream then ends), `purged` (the conversation object; the stream then ends). Comment lines (`: hb`) are heartbeats. Refusals before the first event are ordinary problem responses (403, 404, 422 for an AI chat, 429 TOO_MANY_STREAMS).',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiOperation({
    operationId: 'conversationEvents',
    summary:
      'Participant: live messages of a chat with an expert (server-sent events, resumable with Last-Event-ID).',
  })
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.conversationEventsService.open(id, caller, lastEventId);
  }
}

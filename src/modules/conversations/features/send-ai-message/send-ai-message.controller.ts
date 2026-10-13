import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { SendAiMessageDto } from './dto/send-ai-message.dto';
import { SendAiMessageService, type ChatSink } from './send-ai-message.service';

/** Static, like the other throttles: decorators evaluate before the config layer exists. */
const SEND_RATE_LIMIT = { limit: 10, ttl: 60_000 } as const;
/** Below the 30 to 60 s idle timeouts of common proxies (plan 0019 section 14). */
const HEARTBEAT_MS = 15_000;

@ApiTags('ai-chat')
@Controller({ path: 'ai-conversations', version: '1' })
export class SendAiMessageController {
  private readonly logger = new Logger(SendAiMessageController.name);

  constructor(private readonly sendAiMessageService: SendAiMessageService) {}

  @Post(':id/messages')
  @HttpCode(200)
  @Auth('ai-chat:send:self')
  @Throttle({ default: SEND_RATE_LIMIT })
  @ApiOkResponse({
    description:
      'A `text/event-stream`. Events: `delta` {text} (append), `retract` {text} (replace everything shown with this text), `done` {messageId, seq, state, conversationClosed}, `error` {code}. Comment lines (`: hb`) are heartbeats. Refusals before the first event are ordinary problem responses.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiOperation({
    operationId: 'aiConversationSend',
    summary:
      'Parent (own chat): send a message to the AI assistant and stream its reply. Idempotent on clientMessageId.',
  })
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAiMessageDto,
    @CurrentUser() caller: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    let heartbeat: NodeJS.Timeout | undefined;
    // `close` without a finished response means the client left (`req` does not report it for a POST).
    res.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      if (!res.writableFinished) abort.abort();
    });

    const write = (chunk: string): void => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const sink: ChatSink = {
      start: () => {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        write(': hb\n\n'); // first bytes now: the provider can take a long time to start
        heartbeat = setInterval(() => write(': hb\n\n'), HEARTBEAT_MS);
      },
      event: (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    };

    try {
      await this.sendAiMessageService.stream(id, dto, caller, abort.signal, sink);
    } catch (err) {
      // Before the headers: an ordinary problem response from the global filter.
      if (!res.headersSent) throw err;
      // After them the filter would fail ("headers already sent"), so end the stream here.
      this.logger.warn(
        { errorClass: err instanceof Error ? err.name : 'UnknownError' },
        'ai chat stream failed after start',
      );
    }
    if (heartbeat) clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

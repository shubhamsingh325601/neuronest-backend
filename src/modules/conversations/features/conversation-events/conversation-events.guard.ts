import { CanActivate, ExecutionContext, Injectable, ParseUUIDPipe } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConversationEventsService } from './conversation-events.service';

/**
 * Refuses the events route (bad id 400, unknown 404, not a participant 403, AI chat 422, too many
 * streams 429) as ordinary problem responses. It runs after the global auth guards and before the
 * `@Sse` machinery, which cannot report a status once it has started (see
 * {@link ConversationEventsService.assertCanOpen}). Pipes run after guards, so the id is parsed here.
 */
@Injectable()
export class ConversationEventsGuard implements CanActivate {
  private readonly uuid = new ParseUUIDPipe();

  constructor(private readonly conversationEventsService: ConversationEventsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: { id: string };
      user: AuthenticatedUser;
    }>();
    const id = await this.uuid.transform(request.params.id, { type: 'param', data: 'id' });
    await this.conversationEventsService.assertCanOpen(id, request.user);
    return true;
  }
}

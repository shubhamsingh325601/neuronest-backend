import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import {
  AI_CHAT_TOPICS,
  AI_CHAT_TOPICS_VERSION,
} from '@modules/conversations/shared/ai-chat.constants';
import { ListAiChatTopicsResponseDto } from './dto/list-ai-chat-topics.response.dto';

/**
 * The guided topic list (plan 0019 section 6.1). `ai-chat:send:self` reaches ADMIN through the
 * permission spread, and this list is part of the parent's chat, so the parent only.
 */
@Injectable()
export class ListAiChatTopicsService {
  list(caller: AuthenticatedUser): ListAiChatTopicsResponseDto {
    if (caller.role !== Role.PARENT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    return {
      version: AI_CHAT_TOPICS_VERSION,
      data: AI_CHAT_TOPICS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        kind: t.kind,
      })),
    };
  }
}

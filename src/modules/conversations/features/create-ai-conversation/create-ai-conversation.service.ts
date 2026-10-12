import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AiChatTopic, ConversationKind } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiAccessService } from '@modules/ai-coaching/shared/ai-access.service';
import { findChatTopic } from '@modules/conversations/shared/ai-chat.constants';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';

/** Starts an AI chat session on one guided topic. Only the child's own PARENT (`AiAccessService`). */
@Injectable()
export class CreateAiConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
  ) {}

  async create(
    childId: string,
    dto: CreateAiConversationDto,
    caller: AuthenticatedUser,
  ): Promise<ConversationDto> {
    const child = await this.access.assertCanChat(childId, caller);

    const topic = findChatTopic(dto.topic);
    if (topic?.kind === 'UNAVAILABLE') {
      throw new UnprocessableEntityException({
        code: 'AI_TOPIC_UNAVAILABLE',
        message: 'This topic is not available yet.',
      });
    }
    if (topic?.kind !== 'AI') {
      throw new UnprocessableEntityException({
        code: 'AI_TOPIC_NOT_A_CHAT',
        message: 'This topic opens another screen; it is not an AI chat.',
      });
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        kind: ConversationKind.AI,
        topic: topic.id as AiChatTopic,
        childId,
        parentId: child.parentId,
      },
    });
    return ConversationDto.from(conversation);
  }
}

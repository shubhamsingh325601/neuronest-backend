import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AiChatTopic, ConversationKind, MessageSender, MessageState } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiAccessService } from '@modules/ai-coaching/shared/ai-access.service';
import { chatGreeting, findChatTopic } from '@modules/conversations/shared/ai-chat.constants';
import { chatFirstNames } from '@modules/conversations/shared/ai-chat-context.builder';
import { appendMessage, lockConversation } from '@modules/conversations/shared/append-message';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';

/**
 * Starts an AI chat session on one guided topic. Only the child's own PARENT (`AiAccessService`). The chat opens
 * with a fixed greeting from the assistant (plan 0020), stored in the same transaction, so `lastMessageSeq` is 1.
 */
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

    const parent = await this.prisma.user.findUniqueOrThrow({
      where: { id: caller.id },
      select: { name: true },
    });
    const names = chatFirstNames(child, parent.name);
    const topicId = topic.id as AiChatTopic;

    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: { kind: ConversationKind.AI, topic: topicId, childId, parentId: child.parentId },
      });
      const locked = await lockConversation(tx, created.id);
      await appendMessage(tx, created.id, locked, {
        sender: MessageSender.AI,
        body: chatGreeting(topicId, names.parentName, names.childName),
        state: MessageState.COMPLETE,
      });
      return tx.conversation.findUniqueOrThrow({ where: { id: created.id } });
    });
    return ConversationDto.from(conversation);
  }
}

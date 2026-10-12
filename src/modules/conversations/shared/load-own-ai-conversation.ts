import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConversationKind, Role, type Conversation } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';

/**
 * Loads an AI conversation for the parent who owns it. Every other role is refused, ADMIN included
 * (`ai-chat:send:self` reaches ADMIN through the permission spread).
 */
export async function loadOwnAiConversation(
  prisma: PrismaService,
  id: string,
  caller: AuthenticatedUser,
): Promise<Conversation> {
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) {
    throw new NotFoundException({
      code: 'CONVERSATION_NOT_FOUND',
      message: 'No conversation with that id.',
    });
  }
  if (caller.role !== Role.PARENT || conversation.parentId !== caller.id) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
  if (conversation.kind !== ConversationKind.AI) {
    throw new UnprocessableEntityException({
      code: 'NOT_AN_AI_CONVERSATION',
      message: 'This is a chat with an expert, not with the AI assistant.',
    });
  }
  return conversation;
}

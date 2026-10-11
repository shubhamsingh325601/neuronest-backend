import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type Conversation } from '@prisma/client';
import { assertExpertAssigned } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';

/**
 * Loads a conversation for someone who takes part in it: the child's PARENT, or the EXPERT it
 * names (who must still be assigned to the child). Every other role is refused, ADMIN included,
 * because admin does not read raw chat (plan 0019 §3 row 14).
 */
export async function loadParticipantConversation(
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

  if (caller.role === Role.PARENT && conversation.parentId === caller.id) {
    return conversation;
  }
  if (caller.role === Role.EXPERT && conversation.expertId === caller.id) {
    await assertExpertAssigned(prisma, conversation.childId, caller.id);
    return conversation;
  }
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to access this resource.',
  });
}

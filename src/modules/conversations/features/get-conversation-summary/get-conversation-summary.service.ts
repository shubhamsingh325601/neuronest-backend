import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { assertChildAccess, assertExpertAssigned } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationSummaryDto } from '@modules/conversations/shared/conversation-summary.dto';

/**
 * One conversation's summary. Who may read it: the child's PARENT (their own conversation), the
 * conversation's EXPERT (while still assigned), a CLINICIAN assigned to the child, and ADMIN. Every
 * other role is refused. No message text is read here, so ADMIN is allowed (plan 0019 §3 row 14).
 */
@Injectable()
export class GetConversationSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(conversationId: string, caller: AuthenticatedUser): Promise<ConversationSummaryDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        childId: true,
        parentId: true,
        expertId: true,
        kind: true,
        closedAt: true,
        messagesPurgedAt: true,
        summary: true,
      },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'No conversation with that id.',
      });
    }
    await this.assertCanRead(conversation, caller);
    if (!conversation.summary) {
      throw new NotFoundException({
        code: 'SUMMARY_NOT_FOUND',
        message: 'This conversation has no summary yet.',
      });
    }
    return ConversationSummaryDto.from({ ...conversation.summary, conversation });
  }

  private async assertCanRead(
    conversation: { childId: string; parentId: string; expertId: string | null },
    caller: AuthenticatedUser,
  ): Promise<void> {
    switch (caller.role) {
      case Role.PARENT:
        if (conversation.parentId === caller.id) return;
        break;
      case Role.EXPERT:
        if (conversation.expertId === caller.id) {
          await assertExpertAssigned(this.prisma, conversation.childId, caller.id);
          return;
        }
        break;
      case Role.CLINICIAN:
        await assertChildAccess(this.prisma, conversation.childId, caller, 'read');
        return;
      case Role.ADMIN:
        return;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}

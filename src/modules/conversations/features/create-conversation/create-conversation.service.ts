import { ConflictException, Injectable } from '@nestjs/common';
import { ConversationKind, UserStatus } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';

/**
 * Starts a HUMAN session. Only the child's own PARENT may (ADMIN is refused by `parent-write`).
 * The expert is the child's longest-standing active assignment.
 */
@Injectable()
export class CreateConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(childId: string, caller: AuthenticatedUser): Promise<ConversationDto> {
    const child = await assertChildAccess(this.prisma, childId, caller, 'parent-write');

    const assignment = await this.prisma.expertChildAssignment.findFirst({
      where: { childId, expert: { status: UserStatus.ACTIVE } },
      orderBy: { createdAt: 'asc' },
      select: { expertId: true },
    });
    if (!assignment) {
      throw new ConflictException({
        code: 'NO_EXPERT_ASSIGNED',
        message: 'No expert is assigned to this child yet.',
      });
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        kind: ConversationKind.HUMAN,
        childId,
        parentId: child.parentId,
        expertId: assignment.expertId,
      },
    });
    return ConversationDto.from(conversation);
  }
}

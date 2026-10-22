import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConversationKind, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { ListMyConversationsResponseDto } from './dto/list-my-conversations.response.dto';

/**
 * EXPERT caseload view: every HUMAN conversation the caller takes part in, with the child's
 * name. Ordered by most-recent activity so the Chats tab opens on what moved last.
 * Admin and other roles are refused — the clinician app never surfaces this screen for them.
 */
@Injectable()
export class ListMyConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(caller: AuthenticatedUser): Promise<ListMyConversationsResponseDto> {
    if (caller.role !== Role.EXPERT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    const rows = await this.prisma.conversation.findMany({
      where: { expertId: caller.id, kind: ConversationKind.HUMAN },
      include: { child: { select: { id: true, name: true } } },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });

    return {
      data: rows.map((row) => ({
        ...ConversationDto.from(row),
        child: { id: row.child.id, name: row.child.name },
      })),
    };
  }
}

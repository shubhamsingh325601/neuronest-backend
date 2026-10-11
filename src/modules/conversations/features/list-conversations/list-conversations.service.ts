import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import {
  CursorPaginationQueryDto,
  DEFAULT_PAGE_LIMIT,
} from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { ListConversationsResponseDto } from './dto/list-conversations.response.dto';

/**
 * A child's chat sessions, newest first. The PARENT sees all of them; an assigned EXPERT sees only
 * the ones they take part in. ADMIN and CLINICIAN are refused (`conversation:read` is for participants).
 */
@Injectable()
export class ListConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    query: CursorPaginationQueryDto,
    caller: AuthenticatedUser,
  ): Promise<ListConversationsResponseDto> {
    if (caller.role !== Role.PARENT && caller.role !== Role.EXPERT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    await assertChildAccess(this.prisma, childId, caller, 'read');

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.ConversationWhereInput = {
      childId,
      ...(caller.role === Role.EXPERT ? { expertId: caller.id } : {}),
    };
    const rows = await this.prisma.conversation.findMany({
      where,
      include: { summary: { select: { status: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return {
      data: page.data.map((row) => ({
        ...ConversationDto.from(row),
        summaryStatus: row.summary?.status ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }
}

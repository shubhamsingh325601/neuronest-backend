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
import { ConversationSummaryDto } from '@modules/conversations/shared/conversation-summary.dto';
import { ListConversationSummariesResponseDto } from './dto/list-conversation-summaries.response.dto';

/**
 * A child's conversation summaries, newest first. PARENT (own child), CLINICIAN (assigned) and ADMIN
 * see all of them; an assigned EXPERT sees only those of conversations they took part in. Any other
 * role is refused.
 */
@Injectable()
export class ListConversationSummariesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    query: CursorPaginationQueryDto,
    caller: AuthenticatedUser,
  ): Promise<ListConversationSummariesResponseDto> {
    const allowed: Role[] = [Role.PARENT, Role.CLINICIAN, Role.EXPERT, Role.ADMIN];
    if (!allowed.includes(caller.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    await assertChildAccess(this.prisma, childId, caller, 'read');

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.ConversationSummaryWhereInput = {
      childId,
      ...(caller.role === Role.EXPERT ? { conversation: { expertId: caller.id } } : {}),
    };
    const rows = await this.prisma.conversationSummary.findMany({
      where,
      include: { conversation: { select: { kind: true, closedAt: true, messagesPurgedAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return {
      data: page.data.map((row) => ConversationSummaryDto.from(row)),
      nextCursor: page.nextCursor,
    };
  }
}

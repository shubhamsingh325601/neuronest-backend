import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { MessageDto } from '@modules/conversations/shared/conversation.dto';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';
import { MESSAGE_PAGE_DEFAULT } from '@modules/conversations/shared/message-paging';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';
import { ListMessagesResponseDto } from './dto/list-messages.response.dto';

@Injectable()
export class ListMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    id: string,
    query: ListMessagesQueryDto,
    caller: AuthenticatedUser,
  ): Promise<ListMessagesResponseDto> {
    const conversation = await loadParticipantConversation(this.prisma, id, caller);
    if (conversation.messagesPurgedAt) {
      return { purged: true, items: [] };
    }

    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, seq: { gt: query.afterSeq ?? 0 } },
      orderBy: { seq: 'asc' },
      take: query.limit ?? MESSAGE_PAGE_DEFAULT,
    });
    return { purged: false, items: rows.map(MessageDto.from) };
  }
}

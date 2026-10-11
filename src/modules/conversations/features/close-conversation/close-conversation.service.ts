import { Injectable } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';

/** Closes an OPEN conversation. The conditional update makes a second close a no-op. */
@Injectable()
export class CloseConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async close(id: string, caller: AuthenticatedUser): Promise<ConversationDto> {
    await loadParticipantConversation(this.prisma, id, caller);
    await this.prisma.conversation.updateMany({
      where: { id, status: ConversationStatus.OPEN },
      data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
    });
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id } });
    return ConversationDto.from(conversation);
  }
}

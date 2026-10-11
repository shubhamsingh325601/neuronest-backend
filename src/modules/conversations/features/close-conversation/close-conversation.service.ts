import { Injectable } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';
import { enqueueSummary } from '@modules/conversations/jobs/conversation-summary.queue';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';

/**
 * Closes an OPEN conversation and queues its summary in the same transaction. The conditional update
 * makes a second close a no-op (no second job).
 */
@Injectable()
export class CloseConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  async close(id: string, caller: AuthenticatedUser): Promise<ConversationDto> {
    const { childId } = await loadParticipantConversation(this.prisma, id, caller);
    const closed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.conversation.updateMany({
        where: { id, status: ConversationStatus.OPEN },
        data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
      });
      if (result.count === 1) await enqueueSummary(tx, this.queue, { id, childId });
      return result.count === 1;
    });
    if (closed) await this.queue.kick();
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id } });
    return ConversationDto.from(conversation);
  }
}

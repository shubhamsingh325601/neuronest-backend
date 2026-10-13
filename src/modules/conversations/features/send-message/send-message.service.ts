import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConversationKind, ConversationStatus, MessageSender, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { messageAppended } from '@modules/conversations/shared/conversation-event';
import { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import { MessageDto } from '@modules/conversations/shared/conversation.dto';
import { loadParticipantConversation } from '@modules/conversations/shared/load-participant-conversation';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Appends a message to a HUMAN conversation. The conversation row is locked (`FOR UPDATE`) for the
 * length of the transaction, so two simultaneous sends cannot receive the same `seq`, and a send
 * cannot slip in after a close. A repeated `clientMessageId` returns the stored message. A new message
 * is announced on the event bus after the transaction commits (live events stream; push later).
 */
@Injectable()
export class SendMessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ConversationEventBus,
  ) {}

  async send(id: string, dto: SendMessageDto, caller: AuthenticatedUser): Promise<MessageDto> {
    const conversation = await loadParticipantConversation(this.prisma, id, caller);
    if (conversation.kind !== ConversationKind.HUMAN) {
      throw new UnprocessableEntityException({
        code: 'NOT_A_HUMAN_CONVERSATION',
        message: 'Messages can only be sent here in a chat with an expert.',
      });
    }
    const sender = caller.role === Role.PARENT ? MessageSender.PARENT : MessageSender.EXPERT;

    const { message, created } = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: ConversationStatus; lastMessageSeq: number }[]>`
        SELECT "status", "lastMessageSeq" FROM "conversations" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!locked) {
        throw new NotFoundException({
          code: 'CONVERSATION_NOT_FOUND',
          message: 'No conversation with that id.',
        });
      }

      const existing = await tx.message.findUnique({
        where: {
          conversationId_clientMessageId: {
            conversationId: id,
            clientMessageId: dto.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.senderId !== caller.id) {
          throw new ConflictException({
            code: 'CLIENT_MESSAGE_ID_IN_USE',
            message: 'That clientMessageId was already used by someone else in this conversation.',
          });
        }
        return { message: existing, created: false };
      }

      if (locked.status !== ConversationStatus.OPEN) {
        throw new ConflictException({
          code: 'CONVERSATION_CLOSED',
          message: 'This conversation is closed. Start a new one.',
        });
      }

      const seq = locked.lastMessageSeq + 1;
      const now = new Date();
      await tx.conversation.update({
        where: { id },
        data: { lastMessageSeq: seq, lastMessageAt: now },
      });
      const message = await tx.message.create({
        data: {
          conversationId: id,
          seq,
          sender,
          senderId: caller.id,
          clientMessageId: dto.clientMessageId,
          body: dto.text,
          createdAt: now,
        },
      });
      return { message, created: true };
    });

    if (created) this.bus.publish(messageAppended(conversation, message));
    return MessageDto.from(message);
  }
}

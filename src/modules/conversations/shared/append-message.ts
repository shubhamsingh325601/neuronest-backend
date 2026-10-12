import { NotFoundException } from '@nestjs/common';
import type {
  ConversationStatus,
  Message,
  MessageSender,
  MessageState,
  Prisma,
} from '@prisma/client';

export interface LockedConversation {
  childId: string;
  status: ConversationStatus;
  lastMessageSeq: number;
  offTopicCount: number;
}

/**
 * Locks the conversation row (`FOR UPDATE`) until the transaction ends, so two writers cannot be
 * given the same `seq` and nothing slips in after a close.
 */
export async function lockConversation(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedConversation> {
  const [locked] = await tx.$queryRaw<LockedConversation[]>`
    SELECT "childId", "status", "lastMessageSeq", "offTopicCount" FROM "conversations" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!locked) {
    throw new NotFoundException({
      code: 'CONVERSATION_NOT_FOUND',
      message: 'No conversation with that id.',
    });
  }
  return locked;
}

/** Appends the next message of a locked conversation. */
export async function appendMessage(
  tx: Prisma.TransactionClient,
  id: string,
  locked: LockedConversation,
  data: {
    sender: MessageSender;
    senderId?: string;
    clientMessageId?: string;
    body: string;
    state?: MessageState;
  },
): Promise<Message> {
  const seq = locked.lastMessageSeq + 1;
  const now = new Date();
  await tx.conversation.update({
    where: { id },
    data: { lastMessageSeq: seq, lastMessageAt: now },
  });
  locked.lastMessageSeq = seq;
  return tx.message.create({
    data: {
      conversationId: id,
      seq,
      sender: data.sender,
      senderId: data.senderId,
      clientMessageId: data.clientMessageId,
      body: data.body,
      state: data.state,
      createdAt: now,
    },
  });
}

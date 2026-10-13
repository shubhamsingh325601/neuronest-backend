import type { Conversation, ConversationKind, Message, MessageSender } from '@prisma/client';

/**
 * Chat domain events (plan 0019 section 13, step 6.2).
 *
 * They say THAT something happened and to which conversation, never WHAT was said: no message body,
 * no names. Two consumers read them:
 *  - the live events stream (`GET /conversations/{id}/events`), which loads the message from the
 *    database itself, so the event only has to wake it up;
 *  - the later notification service (push to the other participant), which needs only the ids to
 *    decide who to notify and must not receive chat text. No Firebase or push code exists here.
 *
 * They are published after the transaction that caused them has committed.
 */
interface ConversationEventBase {
  conversationId: string;
  kind: ConversationKind;
  childId: string;
  parentId: string;
  /** Null for an AI conversation. */
  expertId: string | null;
}

export interface MessageAppendedEvent extends ConversationEventBase {
  type: 'message-appended';
  messageId: string;
  seq: number;
  sender: MessageSender;
}

export interface ConversationClosedEvent extends ConversationEventBase {
  type: 'conversation-closed';
  /** MANUAL: a participant closed it. IDLE: the idle sweep did. */
  reason: 'MANUAL' | 'IDLE';
}

export type ConversationEvent = MessageAppendedEvent | ConversationClosedEvent;

type ConversationIds = Pick<Conversation, 'id' | 'kind' | 'childId' | 'parentId' | 'expertId'>;

function base(conversation: ConversationIds): ConversationEventBase {
  return {
    conversationId: conversation.id,
    kind: conversation.kind,
    childId: conversation.childId,
    parentId: conversation.parentId,
    expertId: conversation.expertId,
  };
}

export function messageAppended(
  conversation: ConversationIds,
  message: Pick<Message, 'id' | 'seq' | 'sender'>,
): MessageAppendedEvent {
  return {
    type: 'message-appended',
    ...base(conversation),
    messageId: message.id,
    seq: message.seq,
    sender: message.sender,
  };
}

export function conversationClosed(
  conversation: ConversationIds,
  reason: ConversationClosedEvent['reason'],
): ConversationClosedEvent {
  return { type: 'conversation-closed', ...base(conversation), reason };
}

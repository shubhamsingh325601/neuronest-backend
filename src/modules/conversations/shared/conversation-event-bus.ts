import type { ConversationEvent } from './conversation-event';

export type ConversationEventListener = (event: ConversationEvent) => void;

/**
 * Fan-out of chat domain events to whoever is listening for one conversation.
 *
 * THE SEAM (plan 0019 section 3 row 8). Today there is one backend instance, so the only
 * implementation is in-process memory (`InProcessConversationEventBus`). To run several instances,
 * add an implementation whose `publish` issues Postgres `NOTIFY conversation_events, <json>` and
 * whose listener side holds one `LISTEN` connection (a DIRECT database URL, not the pooler) and calls
 * the local subscribers of each notification; then bind it to this class in `ConversationsModule`.
 * Nothing that publishes or subscribes changes, because the events carry ids only (well below the
 * 8000-byte NOTIFY payload limit) and the stream reads message bodies from the database.
 * Not built here.
 *
 * Contract: `publish` never throws and never blocks on a listener; a listener runs synchronously and
 * must not throw (a throwing listener is contained and logged); delivery is best-effort, so a
 * consumer that must not miss anything (the events stream) also re-reads the database.
 */
export abstract class ConversationEventBus {
  abstract publish(event: ConversationEvent): void;

  /** Returns an idempotent function that removes the subscription. */
  abstract subscribe(conversationId: string, listener: ConversationEventListener): () => void;
}

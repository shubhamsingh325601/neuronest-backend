import { Injectable, Logger } from '@nestjs/common';
import type { ConversationEvent } from './conversation-event';
import { ConversationEventBus, type ConversationEventListener } from './conversation-event-bus';

/** In-memory bus for a single backend instance. See {@link ConversationEventBus} for the seam. */
@Injectable()
export class InProcessConversationEventBus extends ConversationEventBus {
  private readonly logger = new Logger(InProcessConversationEventBus.name);
  private readonly listeners = new Map<string, Set<ConversationEventListener>>();

  publish(event: ConversationEvent): void {
    const subscribed = this.listeners.get(event.conversationId);
    if (!subscribed) return;
    // A copy: a listener may unsubscribe (or subscribe) while the event is being delivered.
    for (const listener of [...subscribed]) {
      try {
        listener(event);
      } catch (err) {
        this.logger.warn(
          {
            errorClass: err instanceof Error ? err.name : 'UnknownError',
            conversationId: event.conversationId,
          },
          'conversation event listener failed',
        );
      }
    }
  }

  subscribe(conversationId: string, listener: ConversationEventListener): () => void {
    let subscribed = this.listeners.get(conversationId);
    if (!subscribed) {
      subscribed = new Set();
      this.listeners.set(conversationId, subscribed);
    }
    subscribed.add(listener);

    return () => {
      const current = this.listeners.get(conversationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(conversationId);
    };
  }

  /** For tests and diagnostics: live subscriptions, for one conversation or in total. */
  subscriberCount(conversationId?: string): number {
    if (conversationId) return this.listeners.get(conversationId)?.size ?? 0;
    let total = 0;
    for (const subscribed of this.listeners.values()) total += subscribed.size;
    return total;
  }
}

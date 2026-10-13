import { Logger } from '@nestjs/common';
import { ConversationKind, MessageSender } from '@prisma/client';
import {
  conversationClosed,
  messageAppended,
  type ConversationEvent,
} from './conversation-event';
import { InProcessConversationEventBus } from './in-process-conversation-event-bus';

const conversation = {
  id: 'c-1',
  kind: ConversationKind.HUMAN,
  childId: 'child-1',
  parentId: 'pa-1',
  expertId: 'ex-1',
};
const appended = (conversationId = 'c-1', seq = 1): ConversationEvent => ({
  ...messageAppended(
    { ...conversation, id: conversationId },
    { id: `m-${seq}`, seq, sender: MessageSender.PARENT },
  ),
});

describe('InProcessConversationEventBus', () => {
  let bus: InProcessConversationEventBus;
  beforeEach(() => {
    bus = new InProcessConversationEventBus();
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers an event only to the subscribers of its own conversation', () => {
    const mine = jest.fn();
    const other = jest.fn();
    bus.subscribe('c-1', mine);
    bus.subscribe('c-2', other);

    bus.publish(appended('c-1'));

    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe, and unsubscribing twice is harmless', () => {
    const listener = jest.fn();
    const unsubscribe = bus.subscribe('c-1', listener);

    unsubscribe();
    unsubscribe();
    bus.publish(appended());

    expect(listener).not.toHaveBeenCalled();
  });

  it('leaks nothing: every subscription is gone after its unsubscribe', () => {
    const unsubscribes = [
      bus.subscribe('c-1', jest.fn()),
      bus.subscribe('c-1', jest.fn()),
      bus.subscribe('c-2', jest.fn()),
    ];
    expect(bus.subscriberCount()).toBe(3);
    expect(bus.subscriberCount('c-1')).toBe(2);

    unsubscribes.forEach((unsubscribe) => unsubscribe());

    expect(bus.subscriberCount()).toBe(0);
    expect(bus.subscriberCount('c-1')).toBe(0);
  });

  it('lets a listener unsubscribe while an event is being delivered', () => {
    const second = jest.fn();
    let unsubscribeFirst: () => void = () => undefined;
    unsubscribeFirst = bus.subscribe('c-1', () => unsubscribeFirst());
    bus.subscribe('c-1', second);

    bus.publish(appended());

    expect(second).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount('c-1')).toBe(1);
  });

  it('contains a throwing listener: the others still run, nothing escapes, only the class is logged', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const after = jest.fn();
    bus.subscribe('c-1', () => {
      throw new TypeError('SECRET-BODY-TEXT');
    });
    bus.subscribe('c-1', after);

    expect(() => bus.publish(appended())).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { errorClass: 'TypeError', conversationId: 'c-1' },
      'conversation event listener failed',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-BODY-TEXT');
  });

  it('publishing with no subscribers does nothing', () => {
    expect(() => bus.publish(conversationClosed(conversation, 'MANUAL'))).not.toThrow();
  });
});

describe('conversation event builders', () => {
  it('carry ids, seq and sender only: no body, no names', () => {
    const event = messageAppended(conversation, { id: 'm-9', seq: 9, sender: MessageSender.EXPERT });

    expect(event).toEqual({
      type: 'message-appended',
      conversationId: 'c-1',
      kind: 'HUMAN',
      childId: 'child-1',
      parentId: 'pa-1',
      expertId: 'ex-1',
      messageId: 'm-9',
      seq: 9,
      sender: 'EXPERT',
    });
    expect(conversationClosed(conversation, 'IDLE')).toEqual({
      type: 'conversation-closed',
      conversationId: 'c-1',
      kind: 'HUMAN',
      childId: 'child-1',
      parentId: 'pa-1',
      expertId: 'ex-1',
      reason: 'IDLE',
    });
  });
});

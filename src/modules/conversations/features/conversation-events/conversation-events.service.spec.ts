import { ConversationKind, ConversationStatus, Role, UserStatus } from '@prisma/client';
import type { MessageEvent } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { InProcessConversationEventBus } from '@modules/conversations/shared/in-process-conversation-event-bus';
import { ConversationEventsService, parseLastEventId, toMessageEvent } from './conversation-events.service';

const user = (id: string, role: Role = Role.PARENT): AuthenticatedUser => ({
  id,
  email: `${id}@example.com`,
  role,
  status: UserStatus.ACTIVE,
});
const parent = user('pa-1');
const expert = user('ex-1', Role.EXPERT);

function setup(
  caps: { perUser?: number; perConversation?: number } = {},
  conversation: Record<string, unknown> = {},
) {
  const row = {
    id: 'c-1',
    kind: ConversationKind.HUMAN,
    topic: null,
    childId: 'child-1',
    parentId: 'pa-1',
    expertId: 'ex-1',
    status: ConversationStatus.OPEN,
    lastMessageSeq: 0,
    lastMessageAt: null,
    closedAt: null,
    messagesPurgedAt: null,
    createdAt: new Date(),
    ...conversation,
  };
  const prisma = {
    conversation: { findUnique: jest.fn(async () => row) },
    message: { findMany: jest.fn(async () => []) },
    user: { findUnique: jest.fn(async () => ({ status: UserStatus.ACTIVE, role: Role.PARENT })) },
    expertChildAssignment: { findUnique: jest.fn(async () => ({ id: 'a-1' })) },
  };
  const bus = new InProcessConversationEventBus();
  const config = {
    get: () => ({
      maxStreamsPerUser: caps.perUser ?? 2,
      maxStreamsPerConversation: caps.perConversation ?? 3,
      streamHeartbeatMs: 60_000,
    }),
  };
  const service = new ConversationEventsService(prisma as never, bus, config as never);
  return { service, prisma, bus };
}

describe('parseLastEventId', () => {
  it.each([
    ['7', 7],
    [' 12 ', 12],
    ['0', 0],
    [undefined, 0],
    ['', 0],
    ['abc', 0],
    ['-3', 0],
    ['1.5', 0],
    ['7, 8', 0],
    ['99999999999999999999', 0],
    ['1e3', 0],
  ])('%j -> %j (a bad header is ignored)', (header, expected) => {
    expect(parseLastEventId(header)).toBe(expected);
  });
});

describe('toMessageEvent', () => {
  it('turns a heartbeat into a comment and every other frame into an event with its own id', () => {
    expect(toMessageEvent({ type: 'heartbeat' })).toEqual({ comment: 'hb' });
    expect(toMessageEvent({ type: 'resync', id: 4, data: { lastSeq: 9 } })).toEqual({
      type: 'resync',
      id: '4',
      data: { lastSeq: 9 },
    });
  });
});

describe('ConversationEventsService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const connect = async (
    service: ConversationEventsService,
    who: AuthenticatedUser,
    header?: string,
  ) => {
    const observable = await service.open('c-1', who, header);
    const events: MessageEvent[] = [];
    const subscription = observable.subscribe({ next: (e) => events.push(e) });
    await jest.advanceTimersByTimeAsync(0);
    return { events, subscription };
  };

  it('refuses a non-participant before any stream exists', async () => {
    const { service } = setup();
    await expect(service.assertCanOpen('c-1', user('other'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.assertCanOpen('c-1', user('adm', Role.ADMIN))).rejects.toMatchObject({
      status: 403,
    });
    expect(service.openStreams()).toBe(0);
  });

  it('refuses an AI conversation with 422', async () => {
    const { service } = setup({}, { kind: ConversationKind.AI, expertId: null });
    await expect(service.assertCanOpen('c-1', parent)).rejects.toMatchObject({
      status: 422,
      response: { code: 'NOT_A_HUMAN_CONVERSATION' },
    });
  });

  it('refuses an expert who is no longer assigned', async () => {
    const { service, prisma } = setup();
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null as never);
    await expect(service.assertCanOpen('c-1', expert)).rejects.toMatchObject({ status: 403 });
  });

  it('counts a stream only while it is open, and frees the slot and the bus subscription on unsubscribe', async () => {
    const { service, bus } = setup();

    const first = await connect(service, parent);
    expect(service.openStreams()).toBe(1);
    expect(bus.subscriberCount('c-1')).toBe(1);

    first.subscription.unsubscribe();

    expect(service.openStreams()).toBe(0);
    expect(bus.subscriberCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('caps open streams per user with 429 TOO_MANY_STREAMS, and a freed slot can be reused', async () => {
    const { service } = setup({ perUser: 2, perConversation: 10 });
    const a = await connect(service, parent);
    await connect(service, parent);

    await expect(service.assertCanOpen('c-1', parent)).rejects.toMatchObject({
      status: 429,
      response: { code: 'TOO_MANY_STREAMS' },
    });
    // The expert has their own allowance.
    await connect(service, expert);

    a.subscription.unsubscribe();
    await expect(service.assertCanOpen('c-1', parent)).resolves.toBeUndefined();
  });

  it('caps open streams per conversation', async () => {
    const { service } = setup({ perUser: 10, perConversation: 2 });
    await connect(service, parent);
    await connect(service, expert);

    await expect(service.assertCanOpen('c-1', parent)).rejects.toMatchObject({ status: 429 });
  });

  it('a stream that is opened but never subscribed takes no slot', async () => {
    const { service } = setup({ perUser: 1 });
    await service.open('c-1', parent, undefined); // never subscribed (the client left first)
    expect(service.openStreams()).toBe(0);
    await expect(connect(service, parent)).resolves.toBeDefined();
  });

  it('passes the Last-Event-ID to the stream and turns frames into SSE events with the seq as id', async () => {
    const { service, prisma } = setup();
    const rows = [
      { id: 'm-2', seq: 2, sender: 'EXPERT', state: 'COMPLETE', body: 'hi', clientMessageId: null, createdAt: new Date() },
    ];
    prisma.conversation.findUnique.mockImplementation((async () => ({
      id: 'c-1',
      kind: ConversationKind.HUMAN,
      topic: null,
      childId: 'child-1',
      parentId: 'pa-1',
      expertId: 'ex-1',
      status: ConversationStatus.OPEN,
      lastMessageSeq: 2,
      lastMessageAt: null,
      closedAt: null,
      messagesPurgedAt: null,
      createdAt: new Date(),
    })) as never);
    prisma.message.findMany.mockImplementation((async (args: { where: { seq: { gt: number } } }) =>
      rows.filter((r) => r.seq > args.where.seq.gt)) as never);

    const withHeader = await connect(service, parent, '1');
    expect(withHeader.events).toEqual([
      { type: 'message', id: '2', data: expect.objectContaining({ seq: 2, body: 'hi' }) },
    ]);
    withHeader.subscription.unsubscribe();

    const caughtUp = await connect(service, parent, '2');
    expect(caughtUp.events).toEqual([]);
    caughtUp.subscription.unsubscribe();

    const garbage = await connect(service, parent, 'not-a-number');
    expect(garbage.events.map((e) => e.id)).toEqual(['2']);
    garbage.subscription.unsubscribe();
  });
});

import { ForbiddenException, Logger } from '@nestjs/common';
import {
  ConversationKind,
  ConversationStatus,
  MessageSender,
  MessageState,
  Role,
  UserStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';
import { conversationClosed, messageAppended } from '@modules/conversations/shared/conversation-event';
import { InProcessConversationEventBus } from '@modules/conversations/shared/in-process-conversation-event-bus';
import {
  ConversationEventStream,
  type ConversationStreamOptions,
  type StreamFrame,
} from './conversation-event-stream';

const SECRET = 'SECRET-CHAT-TEXT-77';
const HEARTBEAT = 1000;
const LIMIT = 100;

interface Row {
  id: string;
  conversationId: string;
  seq: number;
  sender: MessageSender;
  senderId: string | null;
  clientMessageId: string | null;
  body: string;
  state: MessageState;
  createdAt: Date;
}

const parent: AuthenticatedUser = {
  id: 'pa-1',
  email: 'pa@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const expert: AuthenticatedUser = { ...parent, id: 'ex-1', role: Role.EXPERT };

/** A tiny in-memory database holding one conversation and its messages. */
function fakeDb() {
  const state = {
    messages: [] as Row[],
    status: ConversationStatus.OPEN as ConversationStatus,
    purgedAt: null as Date | null,
    userStatus: UserStatus.ACTIVE as UserStatus | null,
    assigned: true,
  };
  const conversation = () => ({
    id: 'c-1',
    kind: ConversationKind.HUMAN,
    topic: null,
    childId: 'child-1',
    parentId: 'pa-1',
    expertId: 'ex-1',
    status: state.status,
    lastMessageSeq: state.messages.length,
    lastMessageAt: null,
    closedAt: state.status === ConversationStatus.CLOSED ? new Date() : null,
    messagesPurgedAt: state.purgedAt,
    createdAt: new Date(),
  });
  const prisma = {
    conversation: { findUnique: jest.fn(async () => conversation()) },
    message: {
      findMany: jest.fn(
        async (args: { where: { seq: { gt: number } }; orderBy: unknown; take: number }) =>
          state.messages.filter((m) => m.seq > args.where.seq.gt).slice(0, args.take),
      ),
    },
    user: {
      findUnique: jest.fn(async (args: { where: { id: string } }) =>
        state.userStatus
          ? { status: state.userStatus, role: args.where.id === 'ex-1' ? Role.EXPERT : Role.PARENT }
          : null,
      ),
    },
    expertChildAssignment: {
      findUnique: jest.fn(async () => (state.assigned ? { id: 'a-1' } : null)),
    },
  };
  const add = (count = 1): Row[] => {
    const added: Row[] = [];
    for (let i = 0; i < count; i++) {
      const seq = state.messages.length + 1;
      const row: Row = {
        id: `m-${seq}`,
        conversationId: 'c-1',
        seq,
        sender: seq % 2 ? MessageSender.PARENT : MessageSender.EXPERT,
        senderId: seq % 2 ? 'pa-1' : 'ex-1',
        clientMessageId: null,
        body: `${SECRET} ${seq}`,
        state: MessageState.COMPLETE,
        createdAt: new Date(),
      };
      state.messages.push(row);
      added.push(row);
    }
    return added;
  };
  return { state, prisma, add };
}

/** What a commit does: the row exists, then the event is published. */
function announce(bus: InProcessConversationEventBus, row: Row) {
  bus.publish(
    messageAppended(
      {
        id: 'c-1',
        kind: ConversationKind.HUMAN,
        childId: 'child-1',
        parentId: 'pa-1',
        expertId: 'ex-1',
      },
      row,
    ),
  );
}

function setup(
  opts: {
    lastEventId?: number;
    caller?: AuthenticatedUser;
    replayLimit?: number;
    seed?: number;
    emit?: (frame: StreamFrame) => void;
  } = {},
) {
  const db = fakeDb();
  const bus = new InProcessConversationEventBus();
  const frames: StreamFrame[] = [];
  const onEnd = jest.fn();
  if (opts.seed) db.add(opts.seed);
  const options: ConversationStreamOptions = {
    conversationId: 'c-1',
    caller: opts.caller ?? parent,
    lastEventId: opts.lastEventId ?? 0,
    replayLimit: opts.replayLimit ?? LIMIT,
    heartbeatMs: HEARTBEAT,
    prisma: db.prisma as unknown as PrismaService,
    bus,
    emit: opts.emit ?? ((frame) => frames.push(frame)),
    onEnd,
  };
  const stream = new ConversationEventStream(options);
  const seqs = () => frames.filter((f) => f.type === 'message').map((f) => (f as { id: number }).id);
  const types = () => frames.map((f) => f.type);
  return { db, bus, frames, onEnd, stream, seqs, types };
}

/** Lets the pending promise chains (the stream's reads) finish. */
const settle = () => jest.advanceTimersByTimeAsync(0);

describe('ConversationEventStream', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('replay, then live', () => {
    it('replays what the client missed in order, then delivers live messages; the frame is the MessageDto', async () => {
      const t = setup({ seed: 3, lastEventId: 1 });

      await t.stream.start();
      expect(t.seqs()).toEqual([2, 3]);
      expect(t.frames[0]).toEqual({
        type: 'message',
        id: 2,
        data: expect.objectContaining({
          id: 'm-2',
          seq: 2,
          sender: 'EXPERT',
          state: 'COMPLETE',
          body: `${SECRET} 2`,
          clientMessageId: null,
        }),
      });

      announce(t.bus, t.db.add()[0]);
      await settle();
      announce(t.bus, t.db.add()[0]);
      await settle();

      expect(t.seqs()).toEqual([2, 3, 4, 5]);
      t.stream.dispose();
    });

    it('a client with nothing (no Last-Event-ID) gets the whole conversation up to the limit', async () => {
      const t = setup({ seed: 3 });
      await t.stream.start();
      expect(t.seqs()).toEqual([1, 2, 3]);
      t.stream.dispose();
    });

    it('a message that arrives during the replay read is delivered exactly once, in order', async () => {
      const t = setup({ seed: 3, lastEventId: 1 });
      // The first read is slow; a message commits (and is announced) while it is in flight.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = t.db.prisma.message.findMany.getMockImplementation()!;
      t.db.prisma.message.findMany.mockImplementationOnce(async (args) => {
        const snapshot = await original(args); // [2, 3]: taken before message 4 exists
        await gate;
        return snapshot;
      });

      const started = t.stream.start();
      await settle();
      const [row] = t.db.add(); // seq 4, published while the replay is in flight
      announce(t.bus, row);
      announce(t.bus, row); // the same event twice
      release();
      await started;
      await settle();

      expect(t.seqs()).toEqual([2, 3, 4]);
      t.stream.dispose();
    });

    it('a message committed before the replay read whose event arrives after it is not repeated', async () => {
      const t = setup({ seed: 3, lastEventId: 0 });
      await t.stream.start();
      const reads = t.db.prisma.message.findMany.mock.calls.length;

      announce(t.bus, t.db.state.messages[2]); // seq 3 again: already sent
      announce(t.bus, t.db.state.messages[0]); // seq 1: already sent
      await settle();

      expect(t.seqs()).toEqual([1, 2, 3]);
      // Skipped without a database read.
      expect(t.db.prisma.message.findMany.mock.calls.length).toBe(reads);
      t.stream.dispose();
    });

    it('two events for the same new message produce one frame', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();

      const [row] = t.db.add();
      announce(t.bus, row);
      announce(t.bus, row);
      await settle();

      expect(t.seqs()).toEqual([2]);
      t.stream.dispose();
    });

    it('a Last-Event-ID beyond the conversation is clamped, so later messages are not hidden', async () => {
      const t = setup({ seed: 2, lastEventId: 9999 });
      await t.stream.start();
      expect(t.seqs()).toEqual([]);

      announce(t.bus, t.db.add()[0]);
      await settle();

      expect(t.seqs()).toEqual([3]);
      t.stream.dispose();
    });
  });

  describe('the replay cap', () => {
    it('exactly the limit is replayed; one more is a resync', async () => {
      const full = setup({ seed: 120, lastEventId: 20, replayLimit: 100 });
      await full.stream.start();
      expect(full.seqs()).toHaveLength(100);
      expect(full.types()).not.toContain('resync');
      full.stream.dispose();

      const over = setup({ seed: 120, lastEventId: 19, replayLimit: 100 });
      await over.stream.start();
      expect(over.seqs()).toEqual([]);
      expect(over.frames).toEqual([{ type: 'resync', id: 19, data: { lastSeq: 120 } }]);
      over.stream.dispose();
    });

    it('after a resync the stream stays open and delivers only newer messages', async () => {
      const t = setup({ seed: 150, lastEventId: 0 });
      await t.stream.start();
      expect(t.types()).toEqual(['resync']);

      announce(t.bus, t.db.add()[0]);
      await settle();

      expect(t.seqs()).toEqual([151]);
      expect(t.frames[1]).toMatchObject({ type: 'message', id: 151 });
      t.stream.dispose();
    });

    it('a burst larger than one page is delivered completely and in order', async () => {
      const t = setup({ seed: 1, lastEventId: 1, replayLimit: 10 });
      await t.stream.start();

      const rows = t.db.add(25);
      announce(t.bus, rows[rows.length - 1]);
      await settle();

      expect(t.seqs()).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
      t.stream.dispose();
    });
  });

  describe('the end of a conversation', () => {
    it('a closed conversation replays what was missed, then sends `closed` and ends', async () => {
      const t = setup({ seed: 3, lastEventId: 1 });
      t.db.state.status = ConversationStatus.CLOSED;

      await t.stream.start();

      expect(t.types()).toEqual(['message', 'message', 'closed']);
      expect(t.frames[2]).toMatchObject({
        type: 'closed',
        id: 3,
        data: { id: 'c-1', status: 'CLOSED' },
      });
      expect(t.onEnd).toHaveBeenCalledTimes(1);
      expect(t.bus.subscriberCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a close while connected sends the last messages first, then `closed`, then ends', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();

      announce(t.bus, t.db.add()[0]);
      t.db.state.status = ConversationStatus.CLOSED;
      t.bus.publish(
        conversationClosed(
          {
            id: 'c-1',
            kind: ConversationKind.HUMAN,
            childId: 'child-1',
            parentId: 'pa-1',
            expertId: 'ex-1',
          },
          'MANUAL',
        ),
      );
      await settle();

      expect(t.types()).toEqual(['message', 'closed']);
      expect(t.frames[1]).toMatchObject({ id: 2 });
      expect(t.onEnd).toHaveBeenCalledTimes(1);
      expect(t.bus.subscriberCount()).toBe(0);
    });

    it('a purged conversation sends `purged` and ends, without reading messages', async () => {
      const t = setup({ seed: 3 });
      t.db.state.status = ConversationStatus.CLOSED;
      t.db.state.purgedAt = new Date();

      await t.stream.start();

      expect(t.types()).toEqual(['purged']);
      expect(t.frames[0]).toMatchObject({ data: { messagesPurgedAt: expect.any(Date) } });
      expect(t.db.prisma.message.findMany).not.toHaveBeenCalled();
      expect(t.onEnd).toHaveBeenCalledTimes(1);
    });

    it('a conversation that no longer exists ends the stream quietly', async () => {
      const t = setup();
      t.db.prisma.conversation.findUnique.mockResolvedValueOnce(null as never);
      await t.stream.start();
      expect(t.frames).toEqual([]);
      expect(t.onEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('heartbeat and access', () => {
    it('sends a heartbeat every interval', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();

      await jest.advanceTimersByTimeAsync(HEARTBEAT * 3);

      expect(t.types().filter((type) => type === 'heartbeat')).toHaveLength(3);
      t.stream.dispose();
    });

    it('repairs a lost event: the next heartbeat delivers a message nobody announced', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();

      t.db.add(); // committed, but the bus never heard of it

      await jest.advanceTimersByTimeAsync(HEARTBEAT);
      expect(t.seqs()).toEqual([2]);
      t.stream.dispose();
    });

    it('ends when the expert was unassigned', async () => {
      const t = setup({ seed: 1, lastEventId: 1, caller: expert });
      await t.stream.start();
      t.db.state.assigned = false;

      await jest.advanceTimersByTimeAsync(HEARTBEAT);

      expect(t.onEnd).toHaveBeenCalledTimes(1);
      expect(t.bus.subscriberCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
      ['deactivated', UserStatus.DEACTIVATED],
      ['suspended', UserStatus.SUSPENDED],
    ])('ends when the account is %s', async (_name, status) => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();
      t.db.state.userStatus = status;

      await jest.advanceTimersByTimeAsync(HEARTBEAT);

      expect(t.onEnd).toHaveBeenCalledTimes(1);
    });

    it('stays open while access holds', async () => {
      const t = setup({ seed: 1, lastEventId: 1, caller: expert });
      await t.stream.start();

      await jest.advanceTimersByTimeAsync(HEARTBEAT * 2);

      expect(t.onEnd).not.toHaveBeenCalled();
      expect(t.bus.subscriberCount('c-1')).toBe(1);
      t.stream.dispose();
    });
  });

  describe('cleanup and failure', () => {
    it('dispose frees the timer and the subscription and silences later events', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();
      expect(t.bus.subscriberCount('c-1')).toBe(1);

      t.stream.dispose();
      t.stream.dispose();
      announce(t.bus, t.db.add()[0]);
      await jest.advanceTimersByTimeAsync(HEARTBEAT * 2);

      expect(t.bus.subscriberCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(t.frames).toEqual([]);
      expect(t.onEnd).not.toHaveBeenCalled(); // the transport left; nobody to tell
    });

    it('a stream disposed before it started never subscribes', async () => {
      const t = setup();
      t.stream.dispose();
      await t.stream.start();
      expect(t.bus.subscriberCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a database failure does not throw or end the stream; the next heartbeat delivers, and only the class is logged', async () => {
      const t = setup({ seed: 2, lastEventId: 0 });
      t.db.prisma.message.findMany.mockRejectedValueOnce(
        new TypeError(`connection lost ${SECRET}`),
      );

      await expect(t.stream.start()).resolves.toBeUndefined();
      expect(t.frames).toEqual([]);
      expect(t.onEnd).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(HEARTBEAT);

      expect(t.seqs()).toEqual([1, 2]);
      expect(warn).toHaveBeenCalledWith(
        { errorClass: 'TypeError', conversationId: 'c-1', userId: 'pa-1' },
        'conversation stream failed while reading messages',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
      t.stream.dispose();
    });

    it('a failing access recheck (not a refusal) keeps the stream open', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();
      t.db.prisma.user.findUnique.mockRejectedValueOnce(new Error('db down'));

      await jest.advanceTimersByTimeAsync(HEARTBEAT);

      expect(t.onEnd).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ errorClass: 'Error' }),
        'conversation stream failed while rechecking access',
      );
      t.stream.dispose();
    });

    it('a throwing transport is contained: no exception reaches the caller or the bus', async () => {
      const t = setup({
        seed: 2,
        emit: () => {
          throw new Error(`socket closed ${SECRET}`);
        },
      });

      await expect(t.stream.start()).resolves.toBeUndefined();
      expect(() => announce(t.bus, t.db.add()[0])).not.toThrow();
      await settle();

      expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
      t.stream.dispose();
    });

    it('treats a refusal by the participant loader as the end of access', async () => {
      const t = setup({ seed: 1, lastEventId: 1 });
      await t.stream.start();
      t.db.prisma.conversation.findUnique.mockImplementation(async () => {
        throw new ForbiddenException();
      });

      await jest.advanceTimersByTimeAsync(HEARTBEAT);

      expect(t.onEnd).toHaveBeenCalledTimes(1);
    });
  });
});

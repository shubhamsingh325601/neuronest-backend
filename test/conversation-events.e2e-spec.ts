import request from 'supertest';
import { ConversationKind, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { ConversationEventsService } from '@modules/conversations/features/conversation-events/conversation-events.service';
import { ConversationJobs } from '@modules/conversations/jobs/conversation.jobs';
import { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import type { InProcessConversationEventBus } from '@modules/conversations/shared/in-process-conversation-event-bus';
import { createTestApp, type TestContext } from './helpers/test-app';
import { SseClient } from './helpers/sse-client';

const HEARTBEAT_MS = 150;

/** Live delivery of the parent-expert chat (plan 0019 batch 6): a really listening server, real sockets. */
describe('Conversation events (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const missingId = '11111111-1111-4111-8111-111111111111';
  const saved: Record<string, string | undefined> = {};
  const clients: SseClient[] = [];
  let baseUrl: string;
  let counter = 0;

  type U = { id: string; token: string };
  let admin: U;
  let parent: U;
  let otherParent: U;
  let clinician: U;
  let expert: U; // assigned to childId
  let strangerExpert: U; // assigned to nobody
  let childId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const createLoggedInUser = async (email: string, role: Role): Promise<U> => {
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await ctx.app.get(PasswordService).hash(password),
        name: role,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    return { id: user.id, token: login.body.accessToken as string };
  };

  const startChat = async () => {
    const res = await http()
      .post(`/v1/children/${childId}/conversations`)
      .set(auth(parent.token))
      .send();
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const send = (id: string, who: U, text: string, clientMessageId = `m-${(counter += 1)}`) =>
    http()
      .post(`/v1/conversations/${id}/messages`)
      .set(auth(who.token))
      .send({ text, clientMessageId });
  const listen = async (id: string, who: U, lastEventId?: string) => {
    const client = await SseClient.open(`${baseUrl}/v1/conversations/${id}/events`, {
      ...auth(who.token),
      ...(lastEventId !== undefined ? { 'last-event-id': lastEventId } : {}),
    });
    clients.push(client);
    return client;
  };
  const bus = () => ctx.app.get(ConversationEventBus) as InProcessConversationEventBus;
  const openStreams = () => ctx.app.get(ConversationEventsService).openStreams();

  beforeAll(async () => {
    for (const key of [
      'AI_ENABLED',
      'CONVERSATION_STREAM_HEARTBEAT_MS',
      'CONVERSATION_STREAMS_PER_USER',
      'CONVERSATION_STREAMS_PER_CONVERSATION',
    ]) {
      saved[key] = process.env[key];
    }
    // The chat with an expert must work with the AI switched off.
    process.env.AI_ENABLED = 'false';
    process.env.CONVERSATION_STREAM_HEARTBEAT_MS = String(HEARTBEAT_MS);
    process.env.CONVERSATION_STREAMS_PER_USER = '4';
    process.env.CONVERSATION_STREAMS_PER_CONVERSATION = '6';
    ctx = await createTestApp();
    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;

    admin = await createLoggedInUser('ev-admin@example.com', Role.ADMIN);
    parent = await createLoggedInUser('ev-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('ev-parent2@example.com', Role.PARENT);
    clinician = await createLoggedInUser('ev-clinician@example.com', Role.CLINICIAN);
    expert = await createLoggedInUser('ev-expert@example.com', Role.EXPERT);
    strangerExpert = await createLoggedInUser('ev-stranger@example.com', Role.EXPERT);
    childId = (
      await ctx.prisma.child.create({
        data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
      })
    ).id;
    await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    // Every test leaves nothing behind: no subscriber, no counted stream.
    for (let i = 0; i < 100 && (bus().subscriberCount() > 0 || openStreams() > 0); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(bus().subscriberCount()).toBe(0);
    expect(openStreams()).toBe(0);
  });
  afterAll(async () => {
    await ctx.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('live delivery', () => {
    it('a message reaches the other participant live, as the same object the GET returns, with its seq as the event id', async () => {
      const id = await startChat();
      const expertStream = await listen(id, expert);
      const parentStream = await listen(id, parent);
      expect(expertStream.status).toBe(200);

      const sent = await send(id, parent, 'Hello expert');
      expect(sent.status).toBe(201);
      await expertStream.waitFor(() => expertStream.seqs().length === 1);
      await parentStream.waitFor(() => parentStream.seqs().length === 1);

      const reply = await send(id, expert, 'Hello parent');
      expect(reply.status).toBe(201);
      await parentStream.waitFor(() => parentStream.seqs().length === 2);

      const read = await http().get(`/v1/conversations/${id}/messages`).set(auth(parent.token));
      expect(expertStream.events('message')[0]).toEqual({
        event: 'message',
        id: '1',
        data: JSON.parse(JSON.stringify(read.body.items[0])),
      });
      expect(parentStream.events('message').map((f) => f.data)).toEqual(
        JSON.parse(JSON.stringify(read.body.items)),
      );
      expect(parentStream.events('message').map((f) => f.id)).toEqual(['1', '2']);
    });

    it('works with AI_ENABLED=false', async () => {
      expect(process.env.AI_ENABLED).toBe('false');
      const id = await startChat();
      const stream = await listen(id, expert);

      await send(id, parent, 'No AI needed');

      await stream.waitFor(() => stream.seqs().length === 1);
    });

    it('a repeated clientMessageId is delivered once', async () => {
      const id = await startChat();
      const stream = await listen(id, expert);

      await send(id, parent, 'Once', 'dup-1');
      await send(id, parent, 'Once', 'dup-1');
      await send(id, parent, 'Twice', 'dup-2');

      await stream.waitFor(() => stream.seqs().length >= 2);
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 2));
      expect(stream.seqs()).toEqual([1, 2]);
    });
  });

  describe('resume', () => {
    it('Last-Event-ID resumes without gaps or repeats after missed messages', async () => {
      const id = await startChat();
      for (let i = 1; i <= 5; i++) await send(id, i % 2 ? parent : expert, `m${i}`);

      const resumed = await listen(id, expert, '2');

      await resumed.waitFor(() => resumed.seqs().length === 3);
      expect(resumed.seqs()).toEqual([3, 4, 5]);

      await send(id, parent, 'live one');
      await resumed.waitFor(() => resumed.seqs().length === 4);
      expect(resumed.seqs()).toEqual([3, 4, 5, 6]);
      expect(resumed.events('resync')).toHaveLength(0);
    });

    it('a missing, malformed or absurd Last-Event-ID is ignored: the whole conversation is replayed', async () => {
      const id = await startChat();
      await send(id, parent, 'a');
      await send(id, expert, 'b');

      for (const header of ['not-a-number', '-4', '99999999999999999999', '']) {
        const stream = await listen(id, expert, header);
        expect(stream.status).toBe(200);
        await stream.waitFor(() => stream.seqs().length === 2);
        expect(stream.seqs()).toEqual([1, 2]);
        stream.close();
      }
      const none = await listen(id, expert);
      await none.waitFor(() => none.seqs().length === 2);
    });

    it('a Last-Event-ID beyond the conversation does not hide later messages', async () => {
      const id = await startChat();
      await send(id, parent, 'a');
      const stream = await listen(id, expert, '500');
      await stream.waitFor(() => stream.comments.length >= 0 && stream.status === 200);

      await send(id, parent, 'b');

      await stream.waitFor(() => stream.seqs().length === 1);
      expect(stream.seqs()).toEqual([2]);
    });

    it('sends `resync` when more than one page was missed, then continues live', async () => {
      const id = await startChat();
      await ctx.prisma.conversation.update({ where: { id }, data: { lastMessageSeq: 130 } });
      await ctx.prisma.message.createMany({
        data: Array.from({ length: 130 }, (_, i) => ({
          conversationId: id,
          seq: i + 1,
          sender: i % 2 ? 'EXPERT' : 'PARENT',
          senderId: i % 2 ? expert.id : parent.id,
          body: `bulk ${i + 1}`,
        })),
      });

      const stream = await listen(id, expert, '5');
      await stream.waitFor(() => stream.events('resync').length === 1);
      expect(stream.events('resync')[0]).toEqual({
        event: 'resync',
        id: '5',
        data: { lastSeq: 130 },
      });
      expect(stream.seqs()).toEqual([]);

      await send(id, parent, 'after the gap');
      await stream.waitFor(() => stream.seqs().length === 1);
      expect(stream.seqs()).toEqual([131]);

      // The client closes the gap with the ordinary read.
      const page = await http()
        .get(`/v1/conversations/${id}/messages?afterSeq=5&limit=100`)
        .set(auth(expert.token));
      expect(page.body.items[0].seq).toBe(6);
    });

    it('messages sent while a stream is connecting arrive exactly once and in order', async () => {
      const id = await startChat();
      for (let i = 1; i <= 30; i++) await send(id, parent, `before ${i}`);

      const stream = listen(id, expert, '0');
      const sends = Promise.all(
        Array.from({ length: 10 }, (_, i) => send(id, i % 2 ? parent : expert, `during ${i}`)),
      );
      const [opened] = await Promise.all([stream, sends]);

      await opened.waitFor(() => opened.seqs().length === 40);
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 2));
      expect(opened.seqs()).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    });
  });

  describe('the end of a conversation', () => {
    it('closing sends `closed` to everyone connected and ends their streams', async () => {
      const id = await startChat();
      const expertStream = await listen(id, expert);
      const parentStream = await listen(id, parent);
      await send(id, parent, 'last words');

      const closed = await http().post(`/v1/conversations/${id}/close`).set(auth(expert.token));
      expect(closed.status).toBeLessThan(300);

      for (const stream of [expertStream, parentStream]) {
        await stream.waitFor(() => stream.ended);
        expect(stream.frames.map((f) => f.event)).toEqual(['message', 'closed']);
        expect(stream.events('closed')[0].data).toMatchObject({ id, status: 'CLOSED' });
        expect(stream.events('closed')[0].id).toBe('1'); // resumes after the last message
      }
    });

    it('connecting to a closed conversation replays the missed messages, then `closed`, then ends', async () => {
      const id = await startChat();
      await send(id, parent, 'a');
      await send(id, expert, 'b');
      await send(id, parent, 'c');
      await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));

      const stream = await listen(id, expert, '1');

      await stream.waitFor(() => stream.ended);
      expect(stream.frames.map((f) => f.event)).toEqual(['message', 'message', 'closed']);
      expect(stream.seqs()).toEqual([2, 3]);
    });

    it('the idle sweep closes a silent chat and tells the connected stream', async () => {
      const id = await startChat();
      await send(id, parent, 'anyone there?');
      const stream = await listen(id, expert);
      await stream.waitFor(() => stream.seqs().length === 1);

      const later = new Date(Date.now() + 25 * 3_600_000);
      await ctx.app.get(ConversationJobs).closeIdle(later);

      await stream.waitFor(() => stream.ended);
      expect(stream.frames.map((f) => f.event)).toEqual(['message', 'closed']);
    });

    it('a purged conversation sends `purged` and ends', async () => {
      const id = await startChat();
      await send(id, parent, 'soon gone');
      await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));
      await ctx.prisma.conversation.update({
        where: { id },
        data: { messagesPurgedAt: new Date(), purgedMessageCount: 1 },
      });
      await ctx.prisma.message.deleteMany({ where: { conversationId: id } });

      const stream = await listen(id, parent);

      await stream.waitFor(() => stream.ended);
      expect(stream.frames.map((f) => f.event)).toEqual(['purged']);
      expect(stream.events('purged')[0].data.messagesPurgedAt).toEqual(expect.any(String));
    });
  });

  describe('who may listen', () => {
    it('refuses everyone but the two participants, before any stream exists', async () => {
      const id = await startChat();
      for (const who of [otherParent, strangerExpert, admin, clinician]) {
        const stream = await listen(id, who);
        expect(stream.status).toBe(403);
        expect(await stream.problem()).toMatchObject({ status: 403 });
      }
      expect(openStreams()).toBe(0);
      expect(bus().subscriberCount()).toBe(0);
    });

    it('refuses an expert whose assignment was removed', async () => {
      const id = await startChat();
      await ctx.prisma.expertChildAssignment.delete({
        where: { expertId_childId: { expertId: expert.id, childId } },
      });
      try {
        expect((await listen(id, expert)).status).toBe(403);
      } finally {
        await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
      }
    });

    it('refuses an AI conversation with 422, an unknown one with 404, a bad id with 400, no token with 401', async () => {
      const ai = await ctx.prisma.conversation.create({
        data: { kind: ConversationKind.AI, topic: 'PLAN_EXPLAINER', childId, parentId: parent.id },
      });
      const refused = await listen(ai.id, parent);
      expect(refused.status).toBe(422);
      expect(await refused.problem()).toMatchObject({ code: 'NOT_A_HUMAN_CONVERSATION' });

      expect((await listen(missingId, parent)).status).toBe(404);
      expect((await listen('not-a-uuid', parent)).status).toBe(400);
      const anonymous = await SseClient.open(`${baseUrl}/v1/conversations/${ai.id}/events`);
      expect(anonymous.status).toBe(401);
    });

    it('ends the stream within a heartbeat or two when the expert is unassigned', async () => {
      const id = await startChat();
      const stream = await listen(id, expert);
      await send(id, parent, 'still here');
      await stream.waitFor(() => stream.seqs().length === 1);

      await ctx.prisma.expertChildAssignment.delete({
        where: { expertId_childId: { expertId: expert.id, childId } },
      });
      try {
        await stream.waitFor(() => stream.ended, HEARTBEAT_MS * 10);
      } finally {
        await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
      }
      expect(stream.events('closed')).toHaveLength(0);
    });

    it('ends the stream when the account is deactivated', async () => {
      const other = await createLoggedInUser('ev-temp-expert@example.com', Role.EXPERT);
      const tempChat = await ctx.prisma.conversation.create({
        data: { kind: ConversationKind.HUMAN, childId, parentId: parent.id, expertId: other.id },
      });
      await ctx.prisma.expertChildAssignment.create({ data: { expertId: other.id, childId } });
      const stream = await listen(tempChat.id, other);
      expect(stream.status).toBe(200);

      await ctx.prisma.user.update({
        where: { id: other.id },
        data: { status: UserStatus.DEACTIVATED },
      });

      await stream.waitFor(() => stream.ended, HEARTBEAT_MS * 10);
    });
  });

  describe('connection housekeeping', () => {
    it('sends heartbeat comments while nothing happens', async () => {
      const id = await startChat();
      const stream = await listen(id, parent);

      await stream.waitFor(() => stream.comments.filter((c) => c === 'hb').length >= 2);

      expect(stream.frames).toEqual([]);
    });

    it('a disconnect frees the subscriber and the stream slot', async () => {
      const id = await startChat();
      const stream = await listen(id, parent);
      await stream.waitFor(() => bus().subscriberCount(id) === 1);
      expect(openStreams()).toBe(1);

      stream.close();

      await new Promise((resolve) => setTimeout(resolve, 50));
      for (let i = 0; i < 100 && bus().subscriberCount(id) > 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(bus().subscriberCount(id)).toBe(0);
      expect(openStreams()).toBe(0);
    });

    it('caps the streams one user can hold open: 429 TOO_MANY_STREAMS, and a closed one frees a slot', async () => {
      const id = await startChat();
      const held = [];
      for (let i = 0; i < 4; i++) held.push(await listen(id, parent));
      for (const s of held) expect(s.status).toBe(200);
      await held[3].waitFor(() => openStreams() === 4);

      const fifth = await listen(id, parent);
      expect(fifth.status).toBe(429);
      expect(await fifth.problem()).toMatchObject({ code: 'TOO_MANY_STREAMS' });
      // The expert has their own allowance.
      expect((await listen(id, expert)).status).toBe(200);

      held[0].close();
      await held[1].waitFor(() => openStreams() === 4);
      expect((await listen(id, parent)).status).toBe(200);
    });

    it('the event contract carries ids only: a message text never goes through the bus', async () => {
      const id = await startChat();
      const seen: unknown[] = [];
      const unsubscribe = bus().subscribe(id, (event) => seen.push(event));

      await send(id, parent, 'PRIVATE-WORDS-123');
      await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));
      unsubscribe();

      expect(seen).toHaveLength(2);
      expect(JSON.stringify(seen)).not.toContain('PRIVATE-WORDS-123');
      expect(seen[0]).toMatchObject({
        type: 'message-appended',
        conversationId: id,
        childId,
        parentId: parent.id,
        expertId: expert.id,
        seq: 1,
        sender: 'PARENT',
      });
      expect(seen[1]).toMatchObject({ type: 'conversation-closed', reason: 'MANUAL' });
    });
  });
});

import request from 'supertest';
import { PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { AiRunError } from '@common/ai/ai.service';
import { PasswordService } from '@common/crypto/password.service';
import {
  AI_CHAT_FOOTER,
  OFF_TOPIC_REDIRECT,
  smallTalkReply,
  RETRACTED_REPLY,
} from '@modules/conversations/shared/ai-chat.constants';
import { createTestApp, type TestContext } from './helpers/test-app';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const [event, data] = block.split('\n');
      return {
        event: event.slice('event: '.length),
        data: JSON.parse(data.slice('data: '.length)),
      };
    });
}

/** Guided AI chat (plan 0019 batch 5): topics, create, streamed send, safety, caps, abort, idempotency. */
describe('AI chat (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const saved: Record<string, string | undefined> = {};
  let counter = 0;

  type Login = { id: string; token: string };
  const createLoggedInUser = async (
    email: string,
    role: Role,
    name: string = role,
  ): Promise<Login> => {
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await ctx.app.get(PasswordService).hash(password),
        name,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    return { id: user.id, token: login.body.accessToken as string };
  };

  let admin: Login;
  let clinician: Login;
  let expert: Login;
  let otherParent: Login;

  /** One parent, one child, an ACTIVE plan with a day 1, an assigned clinician. */
  const family = async (opts: { childName?: string; parentName?: string } = {}) => {
    counter += 1;
    const parent = await createLoggedInUser(
      `chat-parent-${counter}@example.com`,
      Role.PARENT,
      opts.parentName ?? 'Parent',
    );
    const child = await ctx.prisma.child.create({
      data: {
        parentId: parent.id,
        name: opts.childName ?? 'Alex',
        dateOfBirth: new Date('2019-05-14'),
      },
    });
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId: child.id, assignedByAdminId: admin.id },
    });
    const template = await ctx.prisma.planTemplate.create({
      data: { title: 'Sleep', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
    });
    const plan = await ctx.prisma.plan.create({
      data: {
        childId: child.id,
        planTemplateId: template.id,
        startDate: new Date(),
        createdById: admin.id,
        status: PlanStatus.ACTIVE,
      },
    });
    await ctx.prisma.planDay.create({
      data: {
        planId: plan.id,
        dayNumber: 1,
        title: 'Bedtime routine',
        instructions: 'Dim the lights and read one short story.',
      },
    });
    return { parent, childId: child.id };
  };

  const openChat = async (parent: Login, childId: string, topic = 'TODAYS_ACTIVITIES') => {
    const res = await http()
      .post(`/v1/children/${childId}/ai-conversations`)
      .set(auth(parent.token))
      .send({ topic });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const send = (id: string, token: string, text: string, clientMessageId: string) =>
    http()
      .post(`/v1/ai-conversations/${id}/messages`)
      .set(auth(token))
      .send({ text, clientMessageId });

  const stored = (conversationId: string) =>
    ctx.prisma.message.findMany({ where: { conversationId }, orderBy: { seq: 'asc' } });

  beforeAll(async () => {
    for (const key of ['AI_ENABLED', 'GOOGLE_GENERATIVE_AI_API_KEY']) saved[key] = process.env[key];
    process.env.AI_ENABLED = 'true';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key-never-sent';
    ctx = await createTestApp();
    admin = await createLoggedInUser('chat-admin@example.com', Role.ADMIN);
    clinician = await createLoggedInUser(
      'chat-clinician@example.com',
      Role.CLINICIAN,
      'Isha Verma',
    );
    expert = await createLoggedInUser('chat-expert@example.com', Role.EXPERT, 'Dev Anand');
    otherParent = await createLoggedInUser('chat-other-parent@example.com', Role.PARENT);
  });
  afterAll(async () => {
    await ctx.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(() => {
    ctx.ai.reset();
  });

  describe('topics and opening a chat', () => {
    it('lists the guided topics for a parent only', async () => {
      const { parent } = await family();

      const res = await http().get('/v1/ai-chat/topics').set(auth(parent.token));

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([
        'TODAYS_ACTIVITIES',
        'PLAN_EXPLAINER',
        'RECENT_PROGRESS',
        'EVERYDAY_ROUTINES',
        'BOOK_CALL',
        'TALK_TO_EXPERT',
        'AI_ASSESSMENT',
      ]);
      expect(res.body.data.find((t: { id: string }) => t.id === 'AI_ASSESSMENT').kind).toBe(
        'UNAVAILABLE',
      );
      for (const who of [admin, expert, clinician]) {
        expect((await http().get('/v1/ai-chat/topics').set(auth(who.token))).status).toBe(403);
      }
      expect((await http().get('/v1/ai-chat/topics')).status).toBe(401);
    });

    it('opens an AI chat on an AI topic, and refuses a route, an unavailable or an unknown topic', async () => {
      const { parent, childId } = await family();
      const create = (token: string, topic: string) =>
        http().post(`/v1/children/${childId}/ai-conversations`).set(auth(token)).send({ topic });

      const ok = await create(parent.token, 'PLAN_EXPLAINER');
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        kind: 'AI',
        topic: 'PLAN_EXPLAINER',
        status: 'OPEN',
        childId,
      });

      const route = await create(parent.token, 'BOOK_CALL');
      expect(route.status).toBe(422);
      expect(route.body.code).toBe('AI_TOPIC_NOT_A_CHAT');
      const unavailable = await create(parent.token, 'AI_ASSESSMENT');
      expect(unavailable.status).toBe(422);
      expect(unavailable.body.code).toBe('AI_TOPIC_UNAVAILABLE');
      expect((await create(parent.token, 'WEATHER')).status).toBe(400);
    });

    it('refuses another parent, an admin, an expert and a clinician', async () => {
      const { childId } = await family();
      for (const who of [otherParent, admin, expert, clinician]) {
        const res = await http()
          .post(`/v1/children/${childId}/ai-conversations`)
          .set(auth(who.token))
          .send({ topic: 'TODAYS_ACTIVITIES' });
        expect(res.status).toBe(403);
      }
    });
  });

  describe('streaming a reply', () => {
    it('streams sentences, appends the footer by code and stores both messages', async () => {
      const { parent, childId } = await family({ childName: 'Zephyrine', parentName: 'Meera Rao' });
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({
        deltas: [
          'Try starting with one small ',
          'step. Keep it short',
          ' and calm. ',
          'Stop when it gets hard.',
        ],
      });

      const res = await send(
        id,
        parent.token,
        'Zephyrine hates bedtime. Mail meera@example.com or 9876543210',
        'm-1',
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['x-accel-buffering']).toBe('no');
      const events = parseSse(res.text);
      const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.text as string);
      expect(deltas.length).toBeGreaterThanOrEqual(3);
      expect(deltas.join('')).toBe(
        `Try starting with one small step. Keep it short and calm. Stop when it gets hard.\n\n${AI_CHAT_FOOTER}`,
      );
      expect(events[events.length - 1]).toMatchObject({
        event: 'done',
        data: { seq: 2, state: 'COMPLETE', conversationClosed: false },
      });

      const rows = await stored(id);
      expect(rows.map((r) => [r.seq, r.sender, r.state])).toEqual([
        [1, 'PARENT', 'COMPLETE'],
        [2, 'AI', 'COMPLETE'],
      ]);
      expect(rows[0].body).toContain('Zephyrine'); // the parent's own words are kept until purge
      expect(rows[1].body).toBe(deltas.join(''));

      // The model saw redacted text and the topic's context, never names or contact details.
      const [call] = ctx.ai.calls;
      expect(call.capability).toBe('chat-reply');
      expect(call.actor).toEqual({ userId: parent.id, childId });
      const seen = JSON.stringify(call.messages) + call.system;
      expect(seen).not.toMatch(/Zephyrine|Meera|meera@example|9876543210/);
      expect(call.messages).toEqual([
        {
          role: 'user',
          content: 'the child hates bedtime. Mail an email address or a phone number',
        },
      ]);
      expect(call.system).toContain('Bedtime routine');
      expect(ctx.ai.chatOutcomes).toEqual(['COMPLETE']);
    });

    it('keeps earlier turns as history, without the footer', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['First answer here. '] });
      ctx.ai.willStreamChat({ deltas: ['Second answer here. '] });

      await send(id, parent.token, 'First question', 'h-1');
      await send(id, parent.token, 'Second question', 'h-2');

      const second = ctx.ai.calls[1];
      expect(second.messages).toEqual([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer here.' },
        { role: 'user', content: 'Second question' },
      ]);
    });

    it('trims a reply cut at the token limit to whole sentences', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({
        deltas: ['One idea. ', 'Another idea. ', 'An unfinis'],
        finishReason: 'length',
      });

      const res = await send(id, parent.token, 'Help', 'l-1');

      expect(res.status).toBe(200);
      const [, reply] = await stored(id);
      expect(reply.state).toBe('COMPLETE');
      expect(reply.body).toBe(`One idea. Another idea.\n\n${AI_CHAT_FOOTER}`);
    });

    it('retracts a reply that breaks the safety rules and stores the fixed safe text', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({
        deltas: ['That sounds hard. ', 'A dose of melatonin might help at night. ', 'Try a story.'],
      });

      const res = await send(id, parent.token, 'He cannot sleep', 'r-1');

      const events = parseSse(res.text);
      expect(events.map((e) => e.event)).toEqual(['delta', 'retract', 'done']);
      expect(events[1].data.text).toBe(RETRACTED_REPLY);
      expect(events[2].data).toMatchObject({ state: 'RETRACTED' });
      const [, reply] = await stored(id);
      expect(reply).toMatchObject({ sender: 'AI', state: 'RETRACTED', body: RETRACTED_REPLY });
      expect(ctx.ai.chatOutcomes).toEqual(['BLOCKED']);
    });

    it('never strikes a greeting or "who am I", even when the model marks it off-topic', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      for (const [i, text] of ['hi', 'who am I', 'who is my child', 'Hello!'].entries()) {
        ctx.ai.willStreamChat({ deltas: ['[[OFF', '_TOPIC]]'] });
        const res = await send(id, parent.token, text, `g-${i}`);

        const events = parseSse(res.text);
        expect(events.map((e) => e.event)).toEqual(['delta', 'done']);
        expect(events[0].data.text).toBe(smallTalkReply('TODAYS_ACTIVITIES'));
        expect(events[1].data).toMatchObject({ state: 'REDIRECTED', conversationClosed: false });
      }

      const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ offTopicCount: 0, status: 'OPEN' });
    });

    it('answers a greeting the model answered normally as an ordinary reply with the footer', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['Hello! I am an AI assistant. ', 'What would you like to ask?'] });

      const res = await send(id, parent.token, 'hi', 'g-ok');

      const events = parseSse(res.text);
      expect(events[events.length - 1].data).toMatchObject({ state: 'COMPLETE' });
      expect((await stored(id))[1].body.endsWith(AI_CHAT_FOOTER)).toBe(true);
    });

    it('answers an off-topic message with the fixed redirect and closes the chat on the third strike', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      for (let i = 1; i <= 3; i++) {
        ctx.ai.willStreamChat({ deltas: ['[[OFF', '_TOPIC]]'] });
        const res = await send(id, parent.token, `Tell me the news ${i}`, `o-${i}`);
        const events = parseSse(res.text);
        expect(events.map((e) => e.event)).toEqual(['delta', 'done']);
        expect(events[0].data.text).toBe(OFF_TOPIC_REDIRECT);
        expect(events[1].data).toMatchObject({ state: 'REDIRECTED', conversationClosed: i === 3 });
      }

      const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ offTopicCount: 3, status: 'CLOSED' });
      expect(row.closedAt).not.toBeNull();
      expect(
        (await ctx.prisma.conversationSummary.findUnique({ where: { conversationId: id } }))
          ?.status,
      ).toBe('PENDING');
      const again = await send(id, parent.token, 'One more', 'o-4');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('AI_CHAT_OFF_TOPIC_LIMIT');
    });
  });

  describe('failures', () => {
    it('opens the stream before the provider answers: a failure before any text is an error event, nothing stored; the same message can be retried', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({
        deltas: [],
        fail: new AiRunError('AI_TIMEOUT', { retryable: true }),
      });

      const failed = await send(id, parent.token, 'Hello', 'f-1');

      expect(failed.status).toBe(200);
      expect(failed.headers['content-type']).toMatch(/text/event-stream/);
      expect(failed.text.startsWith(': hb')).toBe(true); // first bytes are a heartbeat
      expect(parseSse(failed.text)).toEqual([{ event: 'error', data: { code: 'AI_TIMEOUT' } }]);
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT']);

      ctx.ai.willStreamChat({ deltas: ['Here is help. '] });
      const retry = await send(id, parent.token, 'Hello', 'f-1');

      expect(retry.status).toBe(200);
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT', 'AI']);
    });

    it('turns a failure after the first text into an error event and stores no answer', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({
        deltas: ['Some words that begin an answer, '],
        fail: new AiRunError('AI_TIMEOUT', { retryable: true }),
      });

      const res = await send(id, parent.token, 'Hello', 'f-2');

      expect(res.status).toBe(200);
      const events = parseSse(res.text);
      expect(events[events.length - 1]).toEqual({ event: 'error', data: { code: 'AI_TIMEOUT' } });
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT']);
    });
  });

  describe('idempotency and access', () => {
    it('plays the stored reply back for a repeated clientMessageId, with no second call or message', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['A calm, short answer. '] });
      const first = await send(id, parent.token, 'Hello', 'd-1');
      const firstDone = parseSse(first.text).pop()!;

      const again = await send(id, parent.token, 'Hello', 'd-1');

      expect(again.status).toBe(200);
      const events = parseSse(again.text);
      expect(events.map((e) => e.event)).toEqual(['delta', 'done']);
      expect(events[1].data.messageId).toBe(firstDone.data.messageId);
      expect(ctx.ai.calls).toHaveLength(1);
      expect(await stored(id)).toHaveLength(2);
    });

    it('refuses everyone but the owning parent, before anything is stored or called', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);

      for (const who of [otherParent, admin, expert, clinician]) {
        expect((await send(id, who.token, 'Hi', 'x-1')).status).toBe(403);
      }
      expect((await send(id, parent.token, '   ', 'x-2')).status).toBe(400);
      expect(
        (await send('00000000-0000-4000-8000-000000000000', parent.token, 'Hi', 'x-3')).status,
      ).toBe(404);
      expect(await stored(id)).toHaveLength(0);
      expect(ctx.ai.calls).toHaveLength(0);
    });

    it('keeps the expert chat endpoint for expert chats only, and the cursor read works on AI chats', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['Fine. '] });
      await send(id, parent.token, 'Hi', 'e-1');

      const human = await http()
        .post(`/v1/conversations/${id}/messages`)
        .set(auth(parent.token))
        .send({ text: 'Hi', clientMessageId: 'e-2' });
      expect(human.status).toBe(422);
      expect(human.body.code).toBe('NOT_A_HUMAN_CONVERSATION');

      const list = await http().get(`/v1/conversations/${id}/messages`).set(auth(parent.token));
      expect(list.status).toBe(200);
      expect(list.body.items.map((m: { sender: string }) => m.sender)).toEqual(['PARENT', 'AI']);
    });
  });

  describe('caps', () => {
    it('422 for a message over the limit', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);

      const res = await send(id, parent.token, 'x'.repeat(1001), 'c-1');

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MESSAGE_TOO_LONG');
      expect(await stored(id)).toHaveLength(0);
    });

    it('429 once a chat has its maximum number of parent messages', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      await ctx.prisma.message.createMany({
        data: Array.from({ length: 40 }, (_, i) => ({
          conversationId: id,
          seq: i + 1,
          sender: 'PARENT' as const,
          senderId: parent.id,
          body: 'x',
        })),
      });
      await ctx.prisma.conversation.update({ where: { id }, data: { lastMessageSeq: 40 } });

      const res = await send(id, parent.token, 'One more', 'c-2');

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('AI_CHAT_LIMIT_REACHED');
      expect(ctx.ai.calls).toHaveLength(0);
    });

    it('429 once the parent has sent the daily maximum across all chats', async () => {
      const { parent, childId } = await family();
      const first = await openChat(parent, childId);
      const second = await openChat(parent, childId, 'PLAN_EXPLAINER');
      await ctx.prisma.message.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          conversationId: first,
          seq: i + 1,
          sender: 'PARENT' as const,
          senderId: parent.id,
          body: 'x',
        })),
      });

      const res = await send(second, parent.token, 'One more', 'c-3');

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('AI_CHAT_LIMIT_REACHED');
    });

    it('409 for a closed chat', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));

      const res = await send(id, parent.token, 'Hi', 'c-4');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONVERSATION_CLOSED');
    });
  });

  describe('client leaves mid-stream', () => {
    it('cancels the provider call, stores no answer and frees the chat', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['A first sentence here. ', 'And a second. '], hang: true });
      await ctx.app.listen(0);
      const { port } = ctx.app.getHttpServer().address() as { port: number };

      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/v1/ai-conversations/${id}/messages`, {
        method: 'POST',
        headers: { ...auth(parent.token), 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', clientMessageId: 'a-1' }),
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(await reader.read()).toMatchObject({ done: false }); // text is flowing

      // While the reply is being written, a second send to the same chat is refused.
      const busy = await send(id, parent.token, 'Again', 'a-2');
      expect(busy.status).toBe(409);
      expect(busy.body.code).toBe('AI_CHAT_BUSY');

      controller.abort();
      for (let i = 0; i < 50 && ctx.ai.chatAborts === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(ctx.ai.chatAborts).toBe(1);
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT']);
      // The chat is free again: the same message can be answered.
      ctx.ai.willStreamChat({ deltas: ['Back again. '] });
      expect((await send(id, parent.token, 'Hello', 'a-1')).status).toBe(200);
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT', 'AI']);
    });
  });

  describe('chat closed while the reply is streaming', () => {
    it('ends with an error event coded CONVERSATION_CLOSED and stores no answer', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      ctx.ai.willStreamChat({
        deltas: ['A first sentence here. ', 'And a second. '],
        holdUntil: gate,
      });
      const server = ctx.app.getHttpServer();
      if (!server.listening) await ctx.app.listen(0);
      const { port } = server.address() as { port: number };

      const response = await fetch(`http://127.0.0.1:${port}/v1/ai-conversations/${id}/messages`, {
        method: 'POST',
        headers: { ...auth(parent.token), 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', clientMessageId: 'cl-1' }),
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(await reader.read()).toMatchObject({ done: false }); // text is flowing

      const close = await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));
      expect(close.status).toBeLessThan(300);
      release();

      const decoder = new TextDecoder();
      let rest = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value);
      }
      const events = parseSse(rest);
      expect(events[events.length - 1]).toEqual({
        event: 'error',
        data: { code: 'CONVERSATION_CLOSED' },
      });
      expect(events.map((e) => e.event)).not.toContain('done');
      expect((await stored(id)).map((m) => m.sender)).toEqual(['PARENT']);
    });
  });

  describe('the generic conversation endpoints on an AI chat', () => {
    it('the parent can read its messages and close it; an expert, admin, clinician and other parent get 403', async () => {
      const { parent, childId } = await family();
      const id = await openChat(parent, childId);
      ctx.ai.willStreamChat({ deltas: ['Try one short story. '] });
      expect((await send(id, parent.token, 'Hello', 'g-1')).status).toBe(200);

      for (const who of [expert, admin, clinician, otherParent]) {
        const list = await http().get(`/v1/conversations/${id}/messages`).set(auth(who.token));
        expect(list.status).toBe(403);
        const close = await http().post(`/v1/conversations/${id}/close`).set(auth(who.token));
        expect(close.status).toBe(403);
      }
      // The refusals changed nothing.
      expect((await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } })).status).toBe(
        'OPEN',
      );

      const list = await http().get(`/v1/conversations/${id}/messages`).set(auth(parent.token));
      expect(list.status).toBe(200);
      expect(list.body.purged).toBe(false);
      expect(list.body.items.map((m: { sender: string }) => m.sender)).toEqual(['PARENT', 'AI']);

      const close = await http().post(`/v1/conversations/${id}/close`).set(auth(parent.token));
      expect(close.status).toBeLessThan(300);
      expect(close.body).toMatchObject({ id, kind: 'AI', status: 'CLOSED' });
    });
  });
});

import fs from 'node:fs';
import request from 'supertest';
import {
  ConversationKind,
  ConversationStatus,
  Role,
  SummaryStatus,
  UserStatus,
} from '@prisma/client';
import { AiRunError } from '@common/ai/ai.service';
import { PasswordService } from '@common/crypto/password.service';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import {
  CLOSE_IDLE_JOB,
  ConversationJobs,
  PURGE_JOB,
} from '@modules/conversations/jobs/conversation.jobs';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Human chat and retention (plan 0019 batch 3): lifecycle, seq/idempotency, access, close-idle, purge. */
describe('Conversations (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const missingId = '11111111-1111-4111-8111-111111111111';
  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;

  // Names a summary must not leak: they are not the role words the summary text naturally contains.
  const NAME_BY_ROLE: Record<Role, string> = {
    PARENT: 'Meera Rao',
    EXPERT: 'Dev Anand',
    CLINICIAN: 'Isha Verma',
    ADMIN: 'Asha Nair',
  };
  const createLoggedInUser = async (email: string, role: Role) => {
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await ctx.app.get(PasswordService).hash(password),
        name: NAME_BY_ROLE[role],
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    return { id: user.id, token: login.body.accessToken as string };
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (path: string, token: string) => http().get(`/v1${path}`).set(auth(token));
  const post = (path: string, token: string, body?: object) =>
    http().post(`/v1${path}`).set(auth(token)).send(body);

  type U = { id: string; token: string };
  let admin: U;
  let parent: U;
  let otherParent: U;
  let clinician: U;
  let expert: U; // assigned to childId
  let strangerExpert: U; // assigned to nobody
  let childId: string;
  let otherChildId: string;

  const send = (conversationId: string, token: string, text: string, clientMessageId: string) =>
    post(`/conversations/${conversationId}/messages`, token, { text, clientMessageId });
  const startChat = async () => {
    const res = await post(`/children/${childId}/conversations`, parent.token);
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createLoggedInUser('cv-admin@example.com', Role.ADMIN);
    parent = await createLoggedInUser('cv-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('cv-parent2@example.com', Role.PARENT);
    clinician = await createLoggedInUser('cv-clinician@example.com', Role.CLINICIAN);
    expert = await createLoggedInUser('cv-expert@example.com', Role.EXPERT);
    strangerExpert = await createLoggedInUser('cv-stranger@example.com', Role.EXPERT);

    childId = (
      await ctx.prisma.child.create({
        data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
      })
    ).id;
    otherChildId = (
      await ctx.prisma.child.create({
        data: { parentId: otherParent.id, name: 'Sam', dateOfBirth: new Date('2018-01-01') },
      })
    ).id;
    await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('lifecycle, seq and idempotency', () => {
    it('parent starts a session, both sides chat, and the cursor read pages by seq', async () => {
      const id = await startChat();
      const created = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(created).toMatchObject({
        kind: 'HUMAN',
        status: 'OPEN',
        expertId: expert.id,
        parentId: parent.id,
      });

      const first = await send(id, parent.token, 'Hello expert', 'c-1');
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        seq: 1,
        sender: 'PARENT',
        state: 'COMPLETE',
        body: 'Hello expert',
      });
      const second = await send(id, expert.token, 'Hello parent', 'c-2');
      expect(second.body).toMatchObject({ seq: 2, sender: 'EXPERT' });
      await send(id, parent.token, 'Thanks', 'c-3');

      const all = await get(`/conversations/${id}/messages`, parent.token);
      expect(all.body.purged).toBe(false);
      expect(all.body.items.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3]);
      const after = await get(`/conversations/${id}/messages?afterSeq=1&limit=1`, expert.token);
      expect(after.body.items.map((m: { seq: number }) => m.seq)).toEqual([2]);
      expect(
        (await get(`/conversations/${id}/messages?afterSeq=3`, parent.token)).body.items,
      ).toEqual([]);

      const row = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(row.lastMessageSeq).toBe(3);
      expect(row.lastMessageAt).not.toBeNull();
    });

    it('a repeated clientMessageId returns the stored message instead of a second one', async () => {
      const id = await startChat();
      const a = await send(id, parent.token, 'Only once', 'dup-1');
      const b = await send(id, parent.token, 'Only once', 'dup-1');
      expect(b.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      expect(await ctx.prisma.message.count({ where: { conversationId: id } })).toBe(1);
      expect(
        (await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } })).lastMessageSeq,
      ).toBe(1);

      // The other participant cannot claim the same id.
      const clash = await send(id, expert.token, 'Mine', 'dup-1');
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('CLIENT_MESSAGE_ID_IN_USE');
    });

    it('simultaneous sends never share a seq', async () => {
      const id = await startChat();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          send(id, i % 2 === 0 ? parent.token : expert.token, `message ${i}`, `par-${i}`),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const seqs = results.map((r) => r.body.seq as number).sort((x, y) => x - y);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(
        (await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } })).lastMessageSeq,
      ).toBe(10);
    });

    it('closing ends the session: new messages are refused, a retry of an old one still answers, a second close changes nothing', async () => {
      const id = await startChat();
      await send(id, parent.token, 'Before close', 'k-1');

      const closed = await post(`/conversations/${id}/close`, expert.token);
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.closedAt).not.toBeNull();

      const late = await send(id, parent.token, 'Too late', 'k-2');
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('CONVERSATION_CLOSED');
      expect((await send(id, parent.token, 'Before close', 'k-1')).status).toBe(201);

      const again = await post(`/conversations/${id}/close`, parent.token);
      expect(again.status).toBe(200);
      expect(again.body.closedAt).toBe(closed.body.closedAt);
      // Reading stays possible until the purge.
      expect((await get(`/conversations/${id}/messages`, parent.token)).body.items).toHaveLength(1);
    });

    it('validates the send body', async () => {
      const id = await startChat();
      const bad = (body: object) => post(`/conversations/${id}/messages`, parent.token, body);
      expect((await bad({ text: '', clientMessageId: 'v-1' })).status).toBe(400);
      expect((await bad({ text: 'hi' })).status).toBe(400);
      expect((await bad({ text: 'x'.repeat(2001), clientMessageId: 'v-2' })).status).toBe(400);
      expect((await bad({ text: 'hi', clientMessageId: 'v-3', sender: 'EXPERT' })).status).toBe(
        400,
      );
      expect((await get(`/conversations/${id}/messages?limit=0`, parent.token)).status).toBe(400);
      expect((await get(`/conversations/${id}/messages?afterSeq=-1`, parent.token)).status).toBe(
        400,
      );
    });

    it('an AI conversation cannot take human messages, but its parent can still read it', async () => {
      const ai = await ctx.prisma.conversation.create({
        data: { kind: ConversationKind.AI, topic: 'PLAN_EXPLAINER', childId, parentId: parent.id },
      });
      const res = await send(ai.id, parent.token, 'Hi', 'ai-1');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NOT_A_HUMAN_CONVERSATION');
      expect((await get(`/conversations/${ai.id}/messages`, parent.token)).status).toBe(200);
      expect((await get(`/conversations/${ai.id}/messages`, expert.token)).status).toBe(403);
    });
  });

  describe('who may do what', () => {
    let id: string;
    beforeAll(async () => {
      id = await startChat();
      await send(id, parent.token, 'Private words', 'a-1');
    });

    it('create: only the child parent; no expert assigned is a clear 409', async () => {
      for (const who of [otherParent, expert, admin, clinician, strangerExpert]) {
        expect((await post(`/children/${childId}/conversations`, who.token)).status).toBe(403);
      }
      const noExpert = await post(`/children/${otherChildId}/conversations`, otherParent.token);
      expect(noExpert.status).toBe(409);
      expect(noExpert.body.code).toBe('NO_EXPERT_ASSIGNED');
      expect((await post(`/children/${missingId}/conversations`, parent.token)).status).toBe(404);
    });

    it('send, read and close: participants only; admin, clinician, other parent and other expert get 403', async () => {
      for (const who of [otherParent, strangerExpert, admin, clinician]) {
        expect((await send(id, who.token, 'x', `n-${who.id}`)).status).toBe(403);
        expect((await get(`/conversations/${id}/messages`, who.token)).status).toBe(403);
        expect((await post(`/conversations/${id}/close`, who.token)).status).toBe(403);
      }
      expect((await get(`/conversations/${missingId}/messages`, parent.token)).status).toBe(404);
      expect((await send(missingId, parent.token, 'x', 'm-1')).status).toBe(404);
      expect((await post(`/conversations/${missingId}/close`, parent.token)).status).toBe(404);
    });

    it('an expert whose assignment was removed loses access', async () => {
      await ctx.prisma.expertChildAssignment.delete({
        where: { expertId_childId: { expertId: expert.id, childId } },
      });
      try {
        expect((await get(`/conversations/${id}/messages`, expert.token)).status).toBe(403);
        expect((await send(id, expert.token, 'x', 'gone-1')).status).toBe(403);
      } finally {
        await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
      }
    });

    it('list: parent sees the sessions with summary status and no text; the expert only their own; others 403', async () => {
      const own = await get(`/children/${childId}/conversations`, parent.token);
      expect(own.status).toBe(200);
      expect(own.body.data.length).toBeGreaterThan(0);
      expect(own.body.data[0]).toHaveProperty('summaryStatus', null);
      expect(JSON.stringify(own.body)).not.toContain('Private words');

      // A session this expert is not part of is hidden from them.
      await ctx.prisma.conversation.create({
        data: { kind: ConversationKind.AI, topic: 'PLAN_EXPLAINER', childId, parentId: parent.id },
      });
      const mine = await get(`/children/${childId}/conversations`, expert.token);
      expect(mine.status).toBe(200);
      expect(mine.body.data.length).toBe(own.body.data.length - 1);

      for (const who of [otherParent, strangerExpert, admin, clinician]) {
        expect((await get(`/children/${childId}/conversations`, who.token)).status).toBe(403);
      }
      const page = await get(`/children/${childId}/conversations?limit=1`, parent.token);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.nextCursor).not.toBeNull();
    });
  });

  describe('summaries', () => {
    const output = {
      overview: 'The family talked about broken sleep and a calmer evening routine.',
      themes: ['sleep', 'routines'],
      parentConcerns: ['Frequent night waking'],
      guidanceGiven: ['Keep the same wind-down steps each evening'],
      openQuestions: ['Whether daytime naps are too long'],
      followUpSuggested: true,
    };
    let otherClinician: U;
    let readyId: string; // HUMAN, summary READY, messages still stored
    let aiId: string; // AI, summary READY
    let openId: string; // OPEN, no summary

    const summaryJobs = (conversationId: string) =>
      ctx.prisma.job.findMany({
        where: {
          type: 'conversation.summarise',
          payload: { path: ['conversationId'], equals: conversationId },
        },
      });
    const summaryOf = (conversationId: string) =>
      ctx.prisma.conversationSummary.findUniqueOrThrow({ where: { conversationId } });
    const chatWithTwoMessages = async () => {
      const id = await startChat();
      await send(id, parent.token, 'Alex wakes at night, call me on 98765 43210', 'sm-1');
      await send(id, expert.token, 'Thanks Meera, keep the routine steady', 'sm-2');
      return id;
    };

    beforeAll(async () => {
      otherClinician = await createLoggedInUser('cv-clinician2@example.com', Role.CLINICIAN);
      await ctx.prisma.clinicianChildAssignment.create({
        data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
      });
      ctx.ai.reset();
      ctx.ai.willReturn(output);
      readyId = await chatWithTwoMessages();
      expect((await post(`/conversations/${readyId}/close`, parent.token)).status).toBe(200);
      openId = await startChat();
      const ai = await ctx.prisma.conversation.create({
        data: {
          kind: ConversationKind.AI,
          topic: 'TODAYS_ACTIVITIES',
          childId,
          parentId: parent.id,
          status: ConversationStatus.CLOSED,
          closedAt: new Date(),
        },
      });
      aiId = ai.id;
      await ctx.prisma.conversationSummary.create({
        data: {
          conversationId: aiId,
          childId,
          status: SummaryStatus.READY,
          generatedAt: new Date(),
          content: { ...output, participantsKind: 'AI' },
        },
      });
    });

    it('closing queues one job and the summary is READY; the model only saw scrubbed text', async () => {
      expect(await summaryJobs(readyId)).toHaveLength(1);
      const [job] = await summaryJobs(readyId);
      expect(job).toMatchObject({
        status: 'SUCCEEDED',
        dedupeKey: `summary:${readyId}`,
        payload: { conversationId: readyId },
      });
      expect(await summaryOf(readyId)).toMatchObject({
        status: 'READY',
        childId,
        content: { ...output, participantsKind: 'HUMAN' },
        failureReason: null,
        promptVersion: 1,
      });

      expect(ctx.ai.calls).toHaveLength(1);
      const call = ctx.ai.calls[0];
      expect(call).toMatchObject({
        capability: 'conversation-summary',
        promptId: 'conversation-summary',
      });
      expect(call.actor).toEqual({ childId });
      expect(call.user).toContain('the child wakes at night, call me on a phone number');
      expect(call.user).toContain('Thanks the parent, keep the routine steady');
      for (const leaked of ['Alex', 'Meera', '98765']) expect(call.user).not.toContain(leaked);

      // A second close changes nothing: no second job, no second model call.
      expect((await post(`/conversations/${readyId}/close`, parent.token)).status).toBe(200);
      expect(await summaryJobs(readyId)).toHaveLength(1);
      expect(ctx.ai.calls).toHaveLength(1);
    });

    it('the idle sweep closes a silent session, shows it as PENDING with a job, and the job finishes it', async () => {
      const id = await chatWithTwoMessages();
      await ctx.prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(Date.now() - 25 * HOUR_MS) },
      });

      expect(await ctx.app.get(ConversationJobs).closeIdle()).toBe(1);

      expect(await summaryOf(id)).toMatchObject({ status: 'PENDING', content: null });
      const [job] = await summaryJobs(id);
      expect(job).toMatchObject({ status: 'PENDING', dedupeKey: `summary:${id}`, maxAttempts: 3 });
      const listed = await get(`/children/${childId}/conversations`, parent.token);
      expect(listed.body.data.find((c: { id: string }) => c.id === id).summaryStatus).toBe(
        'PENDING',
      );

      ctx.ai.reset();
      ctx.ai.willReturn(output);
      expect(await ctx.jobs.drain()).toMatchObject({ succeeded: 1, dead: 0 });
      expect((await summaryOf(id)).status).toBe('READY');
    });

    it('a failing provider retries, then the job is DEAD; the backstop then writes a PLACEHOLDER and purges', async () => {
      const id = await chatWithTwoMessages();
      ctx.ai.reset();
      for (let i = 0; i < 3; i++)
        ctx.ai.willFail(new AiRunError('AI_PROVIDER', { retryable: true }));

      expect((await post(`/conversations/${id}/close`, parent.token)).status).toBe(200);
      expect(await summaryOf(id)).toMatchObject({ status: 'FAILED', failureReason: 'AI_PROVIDER' });
      const [first] = await summaryJobs(id);
      expect(first).toMatchObject({ status: 'PENDING', attempts: 1 });

      for (let attempt = 2; attempt <= 3; attempt++) {
        await ctx.prisma.job.update({
          where: { id: first.id },
          data: { runAt: new Date(Date.now() - 1000) },
        });
        await ctx.jobs.drain();
      }
      const [dead] = await summaryJobs(id);
      expect(dead).toMatchObject({ status: 'DEAD', attempts: 3 });
      expect(dead.lastError).toContain('AI_PROVIDER');
      expect((await summaryOf(id)).status).toBe('FAILED');
      expect(await ctx.prisma.message.count({ where: { conversationId: id } })).toBe(2);

      // Thirty-one days on, the purge gives up on the summary and removes the raw messages.
      const later = new Date(Date.now() + 31 * DAY_MS);
      await ctx.app.get(ConversationJobs).purge(later);
      expect(await summaryOf(id)).toMatchObject({
        status: 'PLACEHOLDER',
        failureReason: 'BACKSTOP_REACHED',
        content: null,
      });
      expect(await ctx.prisma.message.count({ where: { conversationId: id } })).toBe(0);
      expect((await summaryJobs(id))[0].status).toBe('DEAD');

      const read = await get(`/conversations/${id}/summary`, parent.token);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ status: 'PLACEHOLDER', content: null });
      expect(read.body.note).toMatch(
        /^Summary unavailable; the conversation was removed on \d{4}-\d{2}-\d{2}\.$/,
      );
    });

    it('a job that fails once and then succeeds ends READY', async () => {
      const id = await chatWithTwoMessages();
      ctx.ai.reset();
      ctx.ai.willFail(new AiRunError('AI_TIMEOUT', { retryable: true }));
      ctx.ai.willReturn(output);

      await post(`/conversations/${id}/close`, parent.token);
      expect((await summaryOf(id)).status).toBe('FAILED');
      const [job] = await summaryJobs(id);
      await ctx.prisma.job.update({
        where: { id: job.id },
        data: { runAt: new Date(Date.now() - 1000) },
      });
      await ctx.jobs.drain();

      expect(await summaryOf(id)).toMatchObject({ status: 'READY', failureReason: null });
      expect((await summaryJobs(id))[0].status).toBe('SUCCEEDED');
    });

    it('reading one summary: parent own, the conversation expert, an assigned clinician and admin; nobody else', async () => {
      const path = `/conversations/${readyId}/summary`;
      for (const who of [parent, expert, clinician, admin]) {
        const res = await get(path, who.token);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          conversationId: readyId,
          kind: 'HUMAN',
          status: 'READY',
          content: { ...output, participantsKind: 'HUMAN' },
          note: null,
        });
      }
      for (const who of [otherParent, strangerExpert, otherClinician]) {
        expect((await get(path, who.token)).status).toBe(403);
      }
    });

    it('an AI conversation summary is for the parent, the assigned clinician and admin, not an expert', async () => {
      const path = `/conversations/${aiId}/summary`;
      for (const who of [parent, clinician, admin]) {
        const res = await get(path, who.token);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ kind: 'AI', status: 'READY' });
      }
      expect((await get(path, expert.token)).status).toBe(403);
    });

    it('an expert who lost the child assignment can no longer read the summary', async () => {
      await ctx.prisma.expertChildAssignment.delete({
        where: { expertId_childId: { expertId: expert.id, childId } },
      });
      try {
        expect((await get(`/conversations/${readyId}/summary`, expert.token)).status).toBe(403);
        expect(
          (await get(`/children/${childId}/conversation-summaries`, expert.token)).status,
        ).toBe(403);
      } finally {
        await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
      }
    });

    it('unknown conversation and a conversation without a summary are 404', async () => {
      const missing = await get(`/conversations/${missingId}/summary`, admin.token);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('CONVERSATION_NOT_FOUND');
      const none = await get(`/conversations/${openId}/summary`, parent.token);
      expect(none.status).toBe(404);
      expect(none.body.code).toBe('SUMMARY_NOT_FOUND');
      expect((await get('/conversations/not-a-uuid/summary', admin.token)).status).toBe(400);
    });

    it('listing a child: parent, assigned clinician and admin see all; the expert only their own chats; others 403', async () => {
      const path = `/children/${childId}/conversation-summaries`;
      const ids = (res: request.Response) =>
        res.body.data.map((s: { conversationId: string }) => s.conversationId);

      for (const who of [parent, clinician, admin]) {
        const res = await get(path, who.token);
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual(expect.arrayContaining([readyId, aiId]));
      }
      const expertView = await get(path, expert.token);
      expect(expertView.status).toBe(200);
      expect(ids(expertView)).toContain(readyId);
      expect(ids(expertView)).not.toContain(aiId);

      for (const who of [otherParent, strangerExpert, otherClinician]) {
        expect((await get(path, who.token)).status).toBe(403);
      }
      expect(
        (await get(`/children/${otherChildId}/conversation-summaries`, parent.token)).status,
      ).toBe(403);
      expect((await get(`/children/${missingId}/conversation-summaries`, admin.token)).status).toBe(
        404,
      );

      const paged = await get(`${path}?limit=1`, parent.token);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.nextCursor).not.toBeNull();
      const next = await get(`${path}?limit=1&cursor=${paged.body.nextCursor}`, parent.token);
      expect(next.body.data[0].id).not.toBe(paged.body.data[0].id);
    });

    it('the summary responses carry no raw message text', async () => {
      const res = await get(`/children/${childId}/conversation-summaries`, admin.token);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('wakes at night');
      expect(text).not.toContain('98765');
    });
  });

  describe('retention jobs (clock-controlled)', () => {
    const now = new Date('2026-12-01T12:00:00.000Z');
    const ago = (ms: number, from: Date = now) => new Date(from.getTime() - ms);
    let jobs: ConversationJobs;

    beforeAll(async () => {
      jobs = ctx.app.get(ConversationJobs);
      // The jobs act on every conversation, so start from none (messages go with them).
      await ctx.prisma.conversation.deleteMany();
    });

    const seed = async (opts: {
      status: ConversationStatus;
      lastMessageAt?: Date;
      createdAt?: Date;
      closedAt?: Date;
      messages?: number;
      summary?: SummaryStatus;
    }) => {
      const conversation = await ctx.prisma.conversation.create({
        data: {
          kind: ConversationKind.HUMAN,
          childId,
          parentId: parent.id,
          expertId: expert.id,
          status: opts.status,
          lastMessageAt: opts.lastMessageAt ?? null,
          lastMessageSeq: opts.messages ?? 0,
          createdAt: opts.createdAt ?? ago(60 * DAY_MS),
          closedAt: opts.closedAt ?? null,
        },
      });
      for (let seq = 1; seq <= (opts.messages ?? 0); seq++) {
        await ctx.prisma.message.create({
          data: {
            conversationId: conversation.id,
            seq,
            sender: seq % 2 ? 'PARENT' : 'EXPERT',
            senderId: seq % 2 ? parent.id : expert.id,
            body: `retention body ${seq}`,
          },
        });
      }
      if (opts.summary) {
        await ctx.prisma.conversationSummary.create({
          data: { conversationId: conversation.id, childId, status: opts.summary },
        });
      }
      return conversation.id;
    };
    const messageCount = (id: string) =>
      ctx.prisma.message.count({ where: { conversationId: id } });
    const reload = (id: string) => ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });

    it('close-idle closes sessions silent for 24 h, counts an empty one from creation, and spares active ones', async () => {
      const stale = await seed({ status: 'OPEN', lastMessageAt: ago(25 * HOUR_MS), messages: 2 });
      const emptyOld = await seed({ status: 'OPEN', createdAt: ago(25 * HOUR_MS) });
      const emptyNew = await seed({ status: 'OPEN', createdAt: ago(2 * HOUR_MS) });
      const active = await seed({ status: 'OPEN', lastMessageAt: ago(23 * HOUR_MS), messages: 1 });

      expect(await jobs.closeIdle(now)).toBe(2);

      expect(await reload(stale)).toMatchObject({ status: 'CLOSED', closedAt: now });
      expect(await reload(emptyOld)).toMatchObject({ status: 'CLOSED', closedAt: now });
      expect((await reload(emptyNew)).status).toBe('OPEN');
      expect((await reload(active)).status).toBe('OPEN');
      expect(await jobs.closeIdle(now)).toBe(0);
      // A message sent now is refused on the closed session.
      expect((await send(stale, parent.token, 'late', 'idle-1')).status).toBe(409);
    });

    it('purge deletes the rows of READY sessions after 7 days and of any session at 30 days, with audit fields', async () => {
      const readyOld = await seed({
        status: 'CLOSED',
        closedAt: ago(8 * DAY_MS),
        messages: 4,
        summary: 'READY',
      });
      const readyFresh = await seed({
        status: 'CLOSED',
        closedAt: ago(6 * DAY_MS),
        messages: 2,
        summary: 'READY',
      });
      const noSummary = await seed({ status: 'CLOSED', closedAt: ago(8 * DAY_MS), messages: 3 });
      const pending = await seed({
        status: 'CLOSED',
        closedAt: ago(29 * DAY_MS),
        messages: 1,
        summary: 'PENDING',
      });
      const stuck = await seed({
        status: 'CLOSED',
        closedAt: ago(31 * DAY_MS),
        messages: 5,
        summary: 'FAILED',
      });
      const emptyStuck = await seed({ status: 'CLOSED', closedAt: ago(31 * DAY_MS) });
      const stillOpen = await seed({ status: 'OPEN', lastMessageAt: ago(DAY_MS / 2), messages: 2 });

      expect(await jobs.purge(now)).toBe(3);

      // Purged: rows are gone, audit fields set, a READY summary is untouched.
      expect(await messageCount(readyOld)).toBe(0);
      expect(await reload(readyOld)).toMatchObject({
        messagesPurgedAt: now,
        purgedMessageCount: 4,
      });
      expect(
        (
          await ctx.prisma.conversationSummary.findUniqueOrThrow({
            where: { conversationId: readyOld },
          })
        ).status,
      ).toBe('READY');
      // Backstop: a placeholder takes the place of the missing summary, then the rows go.
      expect(await messageCount(stuck)).toBe(0);
      expect(await reload(stuck)).toMatchObject({ messagesPurgedAt: now, purgedMessageCount: 5 });
      expect(
        await ctx.prisma.conversationSummary.findUniqueOrThrow({
          where: { conversationId: stuck },
        }),
      ).toMatchObject({
        status: 'PLACEHOLDER',
        failureReason: 'BACKSTOP_REACHED',
        childId,
      });
      expect(await reload(emptyStuck)).toMatchObject({
        messagesPurgedAt: now,
        purgedMessageCount: 0,
      });
      expect(
        await ctx.prisma.conversationSummary.findUniqueOrThrow({
          where: { conversationId: emptyStuck },
        }),
      ).toMatchObject({
        status: 'PLACEHOLDER',
      });

      // Not yet eligible: untouched.
      expect(await messageCount(readyFresh)).toBe(2);
      expect(await messageCount(noSummary)).toBe(3);
      expect(await messageCount(pending)).toBe(1);
      expect(await messageCount(stillOpen)).toBe(2);
      expect((await reload(noSummary)).messagesPurgedAt).toBeNull();

      // After the purge the read endpoint says so, and the conversation and its summary remain.
      const read = await get(`/conversations/${readyOld}/messages`, parent.token);
      expect(read.body).toEqual({ purged: true, items: [] });
      const listed = await get(`/children/${childId}/conversations`, parent.token);
      const row = listed.body.data.find((c: { id: string }) => c.id === readyOld);
      expect(row).toMatchObject({ summaryStatus: 'READY' });
      expect(row.messagesPurgedAt).not.toBeNull();

      // A second pass at the same time changes nothing (idempotent, audit fields kept).
      expect(await jobs.purge(now)).toBe(0);
      expect((await reload(readyOld)).purgedMessageCount).toBe(4);

      // Move the clock: the 7-day rule now covers readyFresh, and the backstop covers the other two.
      const later = new Date(now.getTime() + 24 * DAY_MS);
      expect(await jobs.purge(later)).toBe(3);
      for (const id of [readyFresh, noSummary, pending]) expect(await messageCount(id)).toBe(0);
      expect(await reload(readyFresh)).toMatchObject({
        messagesPurgedAt: later,
        purgedMessageCount: 2,
      });
      expect(
        (
          await ctx.prisma.conversationSummary.findUniqueOrThrow({
            where: { conversationId: noSummary },
          })
        ).status,
      ).toBe('PLACEHOLDER');
      expect(
        (
          await ctx.prisma.conversationSummary.findUniqueOrThrow({
            where: { conversationId: readyFresh },
          })
        ).status,
      ).toBe('READY');

      // Guarantee: no raw message of a closed session older than the backstop survives a purge pass.
      const survivors = await ctx.prisma.message.count({
        where: { conversation: { status: 'CLOSED', closedAt: { lte: ago(30 * DAY_MS, later) } } },
      });
      expect(survivors).toBe(0);
      // The open session was never touched.
      expect(await messageCount(stillOpen)).toBe(2);
    });

    it('both jobs are registered with the real queue and run through it', async () => {
      // Summary jobs queued by the closes above are not what this test is about.
      await ctx.prisma.job.deleteMany({ where: { type: 'conversation.summarise' } });
      const registry = ctx.app.get(JobHandlerRegistry);
      expect(registry.has(CLOSE_IDLE_JOB) && registry.has(PURGE_JOB)).toBe(true);
      expect(registry.recurringJobs().map((r) => r.type)).toEqual(
        expect.arrayContaining([CLOSE_IDLE_JOB, PURGE_JOB]),
      );
      for (const type of [CLOSE_IDLE_JOB, PURGE_JOB]) {
        await ctx.jobs.queue.enqueue(ctx.prisma, { type, payload: {}, dedupeKey: `e2e:${type}` });
      }
      const run = await ctx.jobs.drain();
      expect(run).toMatchObject({ succeeded: 2, dead: 0, retried: 0 });
    });
  });

  describe('no chat text outside messages', () => {
    it('the text appears in no ai_runs row, no job row and no log line', async () => {
      const marker = 'zq-secret-phrase-7731';
      const captured: string[] = [];
      // Pino writes request logs to fd 1 through fs.write(Sync); Nest's own logger uses the stdout stream.
      const spies: jest.SpyInstance[] = (['write', 'writeSync'] as const).map((name) => {
        const real = fs[name] as (...args: unknown[]) => unknown;
        return jest.spyOn(fs, name).mockImplementation(((
          fd: number,
          data: unknown,
          ...rest: unknown[]
        ) => {
          if (fd === 1 || fd === 2) captured.push(String(data));
          return real(fd, data, ...rest);
        }) as never);
      });
      for (const stream of [process.stdout, process.stderr]) {
        const real = stream.write.bind(stream) as (...args: unknown[]) => unknown;
        spies.push(
          jest.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
            captured.push(String(chunk));
            return real(chunk, ...rest);
          }) as never),
        );
      }

      try {
        const id = await startChat();
        await send(id, parent.token, `${marker} from the parent`, 'leak-1');
        await send(id, expert.token, `${marker} from the expert`, 'leak-2');
        await send(id, parent.token, '', 'leak-3'); // a rejected request is logged too
        await post(`/conversations/${id}/close`, parent.token);
        await ctx.prisma.conversation.update({
          where: { id },
          data: { closedAt: new Date(Date.now() - 40 * DAY_MS) },
        });
        const jobs = ctx.app.get(ConversationJobs);
        await jobs.closeIdle();
        await jobs.purge();
        await ctx.jobs.drain();
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }

      // Positive control: the capture really sees this app's request logs.
      expect(captured.join('')).toContain('/v1/conversations');
      expect(captured.join('')).not.toContain(marker);

      const rows = async (table: string) =>
        (
          await ctx.prisma.$queryRawUnsafe<{ t: string }[]>(
            `SELECT row_to_json(x)::text AS t FROM "${table}" x`,
          )
        ).map((r) => r.t);
      for (const table of [
        'ai_runs',
        'ai_outputs',
        'jobs',
        'conversation_summaries',
        'conversations',
      ]) {
        expect((await rows(table)).join('')).not.toContain(marker);
      }
    });
  });
});

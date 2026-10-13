import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Manual, live smoke test of the REAL streaming route (plan 0019 batch 5, close-out A1):
 * `AI_SMOKE_LIVE=1 npm run ai:smoke:chat`. Not part of `npm test` or `npm run test:e2e`.
 *
 * Starts the real app (real model, real SSE) on a random port against the LOCAL Docker database named by
 * TEST_DATABASE_URL (it refuses any non-local host), creates a synthetic parent, child, plan and AI
 * conversation, then sends three messages through `POST /v1/ai-conversations/{id}/messages`:
 * an on-topic one, an off-topic one, and one the client abandons mid-stream.
 *
 * Output is event names, counts, timings, stored message states and `ai_runs` statuses. It never prints a
 * key, a token, a prompt, a message or a reply. The synthetic rows are removed at the end.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

interface Run {
  label: string;
  httpStatus: number;
  sequence: string[];
  chunks: number;
  events: number;
  ttfbMs: number;
  firstDeltaMs: number | null;
  totalMs: number;
  maxGapMs: number;
  heartbeats: number;
  doneState: string | null;
  replyEndsWithFooter: boolean | null;
  abortedAfterMs: number | null;
}

const round = (ms: number): number => Math.round(ms);

/** "delta, delta, delta, done" -> "delta×3 → done" */
function collapse(names: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < names.length; ) {
    let j = i;
    while (j < names.length && names[j] === names[i]) j += 1;
    out.push(j - i > 1 ? `${names[i]}×${j - i}` : names[i]);
    i = j;
  }
  return out.join(' → ');
}

async function main(): Promise<void> {
  if (process.env.AI_SMOKE_LIVE !== '1') {
    console.log('Dry run. Set AI_SMOKE_LIVE=1 to send real requests to the AI provider.');
    return;
  }
  if (process.env.CI) throw new Error('Refusing to run against a live model in CI.');

  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl) throw new Error('TEST_DATABASE_URL must point at the local Docker Postgres.');
  if (!LOCAL_HOSTS.has(new URL(dbUrl).hostname)) {
    throw new Error('Refusing to run: the smoke database host is not local.');
  }

  // Explicit overrides, set before the app is loaded: never the database in DATABASE_URL.
  process.env.DATABASE_URL = dbUrl;
  process.env.DATABASE_DIRECT_URL = dbUrl;
  process.env.AI_ENABLED = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.LOG_LEVEL = 'silent';
  process.env.SENTRY_DSN = '';
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && (process.env.AI_MODEL ?? 'google:').startsWith('google:')) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set in .env.');
  }

  const { NestFactory } = await import('@nestjs/core');
  const { PlanStatus, PlanTemplateStatus, Role, UserStatus } = await import('@prisma/client');
  const { AppModule } = await import('@app/app.module');
  const { configureApp } = await import('@common/bootstrap/configure-app');
  const { AccessTokenService } = await import('@common/authz/access-token.service');
  const { PrismaService } = await import('@common/prisma/prisma.service');
  const { AI_CHAT_FOOTER } = await import('@modules/conversations/shared/ai-chat.constants');

  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const prisma = app.get(PrismaService);
  const tokens = app.get(AccessTokenService);

  const tag = `smoke-${Date.now()}`;
  const created: { userIds: string[]; childId?: string; templateId?: string; planId?: string } = {
    userIds: [],
  };

  const cleanup = async (): Promise<void> => {
    const steps: (() => Promise<unknown>)[] = [
      () => prisma.aiRun.deleteMany({ where: { userId: { in: created.userIds } } }),
      () => prisma.conversation.deleteMany({ where: { parentId: { in: created.userIds } } }),
      () => prisma.plan.deleteMany({ where: { id: created.planId } }),
      () => prisma.planTemplate.deleteMany({ where: { id: created.templateId } }),
      () => prisma.child.deleteMany({ where: { id: created.childId } }),
      () => prisma.user.deleteMany({ where: { id: { in: created.userIds } } }),
    ];
    let failed = 0;
    for (const step of steps) {
      try {
        await step();
      } catch {
        failed += 1;
      }
    }
    console.log(failed === 0 ? 'cleanup: synthetic rows removed' : `cleanup: ${failed} step(s) failed`);
  };

  try {
    const admin = await prisma.user.create({
      data: {
        email: `${tag}-admin@example.invalid`,
        passwordHash: 'unused',
        name: 'Smoke Admin',
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const parent = await prisma.user.create({
      data: {
        email: `${tag}-parent@example.invalid`,
        passwordHash: 'unused',
        name: 'Smoke Parent',
        role: Role.PARENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    created.userIds.push(admin.id, parent.id);
    const child = await prisma.child.create({
      data: { parentId: parent.id, name: 'Zephyrine', dateOfBirth: new Date('2019-05-14') },
    });
    created.childId = child.id;
    const template = await prisma.planTemplate.create({
      data: { title: 'Sleep', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
    });
    created.templateId = template.id;
    const plan = await prisma.plan.create({
      data: {
        childId: child.id,
        planTemplateId: template.id,
        startDate: new Date(),
        createdById: admin.id,
        status: PlanStatus.ACTIVE,
      },
    });
    created.planId = plan.id;
    await prisma.planDay.create({
      data: {
        planId: plan.id,
        dayNumber: 1,
        title: 'Bedtime routine',
        instructions: 'Dim the lights ten minutes earlier, then read one short story together.',
      },
    });

    const { accessToken } = await tokens.issue(parent);
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

    const open = await fetch(`${base}/v1/children/${child.id}/ai-conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: 'TODAYS_ACTIVITIES' }),
    });
    if (open.status !== 201) throw new Error(`Could not open the chat (HTTP ${open.status}).`);
    const conversationId = ((await open.json()) as { id: string }).id;

    /** Sends one message and reads the stream; optionally abandons it after the first delta. */
    const send = async (
      label: string,
      text: string,
      clientMessageId: string,
      abortAtFirstDelta = false,
    ): Promise<Run> => {
      const controller = new AbortController();
      const t0 = performance.now();
      const run: Run = {
        label,
        httpStatus: 0,
        sequence: [],
        chunks: 0,
        events: 0,
        ttfbMs: 0,
        firstDeltaMs: null,
        totalMs: 0,
        maxGapMs: 0,
        heartbeats: 0,
        doneState: null,
        replyEndsWithFooter: null,
        abortedAfterMs: null,
      };
      let reply = '';
      try {
        const res = await fetch(`${base}/v1/ai-conversations/${conversationId}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, clientMessageId }),
          signal: controller.signal,
        });
        run.httpStatus = res.status;
        run.ttfbMs = round(performance.now() - t0);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let last = performance.now();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const now = performance.now();
          run.chunks += 1;
          run.maxGapMs = Math.max(run.maxGapMs, round(now - last));
          last = now;
          buffer += decoder.decode(value, { stream: true });
          let cut = buffer.indexOf('\n\n');
          while (cut !== -1) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            cut = buffer.indexOf('\n\n');
            if (block.startsWith(':')) {
              run.heartbeats += 1;
              continue;
            }
            const name = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (!name) continue;
            run.events += 1;
            run.sequence.push(name);
            const parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
            if (name === 'delta' || name === 'retract') {
              if (run.firstDeltaMs === null) run.firstDeltaMs = round(now - t0);
              reply = name === 'retract' ? String(parsed.text) : reply + String(parsed.text);
              if (abortAtFirstDelta) {
                run.abortedAfterMs = round(performance.now() - t0);
                controller.abort();
              }
            }
            if (name === 'done') run.doneState = String(parsed.state);
          }
        }
      } catch {
        // Aborted by us on purpose, or the connection dropped (reported by the checks below).
      }
      run.totalMs = round(performance.now() - t0);
      if (run.doneState === 'COMPLETE') run.replyEndsWithFooter = reply.endsWith(AI_CHAT_FOOTER);
      return run;
    };

    const runs: Run[] = [];
    runs.push(
      await send('1 on-topic', 'How can I make bedtime easier tonight?', `${tag}-m1`),
    );
    runs.push(await send('2 off-topic', "Tell me today's news headlines.", `${tag}-m2`));
    runs.push(
      await send(
        '3 client abort',
        'Please explain step by step how to do the bedtime routine, and what to expect.',
        `${tag}-m3`,
        true,
      ),
    );
    // Give the abandoned run time to be recorded.
    for (let i = 0; i < 100; i++) {
      const done = await prisma.aiRun.count({ where: { userId: parent.id } });
      if (done >= 3) break;
      await sleep(50);
    }

    console.log('\n== Streams ==');
    for (const r of runs) {
      console.log(
        `${r.label}: http=${r.httpStatus} events=[${collapse(r.sequence)}] chunks=${r.chunks} ` +
          `ttfb=${r.ttfbMs}ms firstDelta=${r.firstDeltaMs ?? '-'}ms total=${r.totalMs}ms ` +
          `maxGap=${r.maxGapMs}ms heartbeats=${r.heartbeats} done.state=${r.doneState ?? '-'} ` +
          `footer=${r.replyEndsWithFooter ?? '-'}${r.abortedAfterMs !== null ? ` abortedAt=${r.abortedAfterMs}ms` : ''}`,
      );
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
      select: { seq: true, sender: true, state: true, body: true },
    });
    console.log('\n== Stored messages ==');
    for (const m of messages) console.log(`seq=${m.seq} ${m.sender} ${m.state} chars=${m.body.length}`);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true, offTopicCount: true },
    });
    console.log(`conversation: status=${conversation.status} offTopicCount=${conversation.offTopicCount}`);

    const aiRuns = await prisma.aiRun.findMany({
      where: { userId: parent.id },
      orderBy: { createdAt: 'asc' },
      select: {
        capability: true,
        status: true,
        attempt: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        latencyMs: true,
        errorClass: true,
        httpStatus: true,
      },
    });
    console.log('\n== ai_runs ==');
    for (const r of aiRuns) {
      console.log(
        `${r.capability} ${r.status} attempt=${r.attempt} model=${r.model} in=${r.inputTokens ?? '-'} ` +
          `out=${r.outputTokens ?? '-'} latency=${r.latencyMs}ms` +
          `${r.errorClass ? ` errorClass=${r.errorClass}` : ''}${r.httpStatus ? ` http=${r.httpStatus}` : ''}`,
      );
    }

    // What should have happened.
    const anomalies: string[] = [];
    const [first, second, third] = runs;
    if (first.httpStatus !== 200) anomalies.push(`message 1: HTTP ${first.httpStatus}, expected 200`);
    if (first.doneState !== 'COMPLETE') anomalies.push(`message 1: done.state=${first.doneState}, expected COMPLETE`);
    if (first.replyEndsWithFooter !== true) anomalies.push('message 1: the AI footer is missing');
    if (second.doneState !== 'REDIRECTED') anomalies.push(`message 2: done.state=${second.doneState}, expected REDIRECTED`);
    if (!third.sequence.includes('delta')) anomalies.push('message 3: no delta arrived before the abort');
    if (third.sequence.includes('done')) anomalies.push('message 3: finished although the client left');
    for (const r of [first, second]) {
      if (!r.sequence.includes('done')) anomalies.push(`${r.label}: no done event`);
      if (r.firstDeltaMs !== null && r.events > 1 && r.chunks === 1) {
        anomalies.push(`${r.label}: all events arrived in one network chunk (clumped)`);
      }
      if (r.totalMs >= 15000 && r.heartbeats === 0) anomalies.push(`${r.label}: no heartbeat in ${r.totalMs}ms`);
    }
    const states = messages.map((m) => `${m.sender}:${m.state}`);
    const expectedStates = ['PARENT:COMPLETE', 'AI:COMPLETE', 'PARENT:COMPLETE', 'AI:REDIRECTED', 'PARENT:COMPLETE'];
    if (JSON.stringify(states) !== JSON.stringify(expectedStates)) {
      anomalies.push(`stored messages are [${states.join(', ')}], expected [${expectedStates.join(', ')}]`);
    }
    if (aiRuns.length !== 3) anomalies.push(`ai_runs has ${aiRuns.length} row(s), expected 3 (one per message)`);
    const statuses = aiRuns.map((r) => r.status);
    if (statuses[0] !== 'SUCCEEDED') anomalies.push(`run 1 status ${statuses[0]}, expected SUCCEEDED`);
    if (statuses[1] !== 'SUCCEEDED') anomalies.push(`run 2 status ${statuses[1]}, expected SUCCEEDED`);
    if (statuses[2] !== 'CLIENT_ABORTED') anomalies.push(`run 3 status ${statuses[2]}, expected CLIENT_ABORTED`);
    if (aiRuns.some((r) => r.capability !== 'chat-reply')) anomalies.push('an ai_runs row has another capability than chat-reply');

    console.log('\n== Anomalies ==');
    console.log(anomalies.length === 0 ? 'none' : anomalies.map((a) => `- ${a}`).join('\n'));
    console.log(
      '\nnote: the stream sends a heartbeat every 15 s, so replies shorter than that show heartbeats=0 by design.',
    );
  } finally {
    await cleanup();
    await app.close();
  }
}

main().catch((err: unknown) => {
  // Class only: an SDK or database error object can carry request data.
  console.error(`smoke failed: ${err instanceof Error ? err.name : 'UnknownError'}`);
  process.exitCode = 1;
});

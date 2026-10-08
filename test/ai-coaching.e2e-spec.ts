import request from 'supertest';
import { AiOutputStatus, AiRunStatus, PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { AiRunError } from '@common/ai/ai.service';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

const TIP = {
  headline: 'A calm start to the evening',
  body: 'A predictable routine can make bedtime feel safer. Keep the steps short and the room quiet.',
  tryThis: ['Dim the lights ten minutes earlier.', 'Use the same two songs each night.'],
};

describe('AI coaching tip (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const saved: Record<string, string | undefined> = {};
  let counter = 0;

  type Login = { id: string; token: string };
  const createLoggedInUser = async (email: string, role: Role): Promise<Login> => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: role,
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
  let unassignedClinician: Login;
  let otherParent: Login;

  /** One parent, one child (a parent can have only one), an ACTIVE plan with a day-1 entry. */
  const family = async (opts: { withPlan?: boolean; name?: string } = {}) => {
    counter += 1;
    const parent = await createLoggedInUser(`ai-parent-${counter}@example.com`, Role.PARENT);
    const child = await ctx.prisma.child.create({
      data: {
        parentId: parent.id,
        name: opts.name ?? 'Alex',
        dateOfBirth: new Date('2019-05-14'),
      },
    });
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId: child.id, assignedByAdminId: admin.id },
    });
    let planId: string | undefined;
    let dayId: string | undefined;
    if (opts.withPlan !== false) {
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
      const day = await ctx.prisma.planDay.create({
        data: {
          planId: plan.id,
          dayNumber: 1,
          title: 'Bedtime routine',
          instructions: 'Dim the lights and read one short story.',
        },
      });
      planId = plan.id;
      dayId = day.id;
    }
    return { parent, childId: child.id, planId, dayId };
  };

  const generate = (childId: string, token: string) =>
    http().post(`/v1/children/${childId}/ai-coaching-tips`).set(auth(token));
  const getToday = (childId: string, token: string) =>
    http().get(`/v1/children/${childId}/ai-coaching-tips/today`).set(auth(token));
  const retryable = () => new AiRunError('AI_PROVIDER', { retryable: true, httpStatus: 503 });

  beforeAll(async () => {
    for (const key of ['AI_ENABLED', 'GOOGLE_GENERATIVE_AI_API_KEY']) saved[key] = process.env[key];
    process.env.AI_ENABLED = 'true';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key-never-sent';
    ctx = await createTestApp();
    admin = await createLoggedInUser('ai-admin@example.com', Role.ADMIN);
    clinician = await createLoggedInUser('ai-clinician@example.com', Role.CLINICIAN);
    unassignedClinician = await createLoggedInUser('ai-clinician-2@example.com', Role.CLINICIAN);
    otherParent = await createLoggedInUser('ai-other-parent@example.com', Role.PARENT);
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

  describe('POST /v1/children/:childId/ai-coaching-tips', () => {
    it('201 generates for the parent, then 200 serves the cache with no second AI call', async () => {
      const { parent, childId } = await family();
      ctx.ai.willReturn(TIP);

      const first = await generate(childId, parent.token);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        status: 'READY',
        tip: TIP,
        aiGenerated: true,
        disclaimer: expect.stringContaining('not medical advice'),
      });
      expect(first.body.generatedAt).toEqual(expect.any(String));

      const second = await generate(childId, parent.token);
      expect(second.status).toBe(200);
      expect(second.body.tip).toEqual(TIP);
      expect(ctx.ai.calls).toHaveLength(1);
      expect(await ctx.prisma.aiOutput.count({ where: { childId } })).toBe(1);
    });

    it('never exposes the prompt version, provider or model', async () => {
      const { parent, childId } = await family();
      ctx.ai.willReturn(TIP);

      const res = await generate(childId, parent.token);

      const json = JSON.stringify(res.body);
      expect(json).not.toMatch(/fake|promptVersion|provider|model|inputHash/i);
    });

    it('sends the model no child name, and records no prompt or output text in ai_runs', async () => {
      const { parent, childId } = await family({ name: 'Zephyrine' });
      await ctx.prisma.planDay.updateMany({
        where: { plan: { childId } },
        data: { instructions: 'Ask Zephyrine to pick a bedtime story.' },
      });
      ctx.ai.willReturn(TIP);

      expect((await generate(childId, parent.token)).status).toBe(201);

      const [call] = ctx.ai.calls;
      expect(call.user).not.toContain('Zephyrine');
      expect(call.system).not.toContain('Zephyrine');
      expect(call.user).toContain('the child');
      expect(call.actor).toEqual({ userId: parent.id, childId });
      expect(JSON.stringify(await ctx.prisma.aiRun.findMany())).not.toContain('Zephyrine');
    });

    it('404 PLAN_NOT_FOUND when the child has no active plan; nothing is stored or called', async () => {
      const { parent, childId } = await family({ withPlan: false });

      const res = await generate(childId, parent.token);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PLAN_NOT_FOUND');
      expect(ctx.ai.calls).toHaveLength(0);
      expect(await ctx.prisma.aiOutput.count({ where: { childId } })).toBe(0);
    });

    it('401 without a token', async () => {
      const { childId } = await family();
      expect((await http().post(`/v1/children/${childId}/ai-coaching-tips`)).status).toBe(401);
    });

    describe('authorization', () => {
      it('another parent 403, an assigned clinician 403, an unassigned clinician 403, an admin 403', async () => {
        const { childId } = await family();

        for (const who of [otherParent, clinician, unassignedClinician, admin]) {
          const res = await generate(childId, who.token);
          expect(res.status).toBe(403);
        }
        expect(ctx.ai.calls).toHaveLength(0);
        expect(await ctx.prisma.aiOutput.count({ where: { childId } })).toBe(0);
      });

      it('404 for a child that does not exist', async () => {
        const res = await generate('00000000-0000-4000-8000-000000000000', otherParent.token);
        expect(res.status).toBe(404);
      });
    });

    describe('regeneration', () => {
      it('regenerates once when the clinician changes the day, never more than twice a day', async () => {
        const { parent, childId, dayId } = await family();
        ctx.ai.defaultOutput = TIP;

        expect((await generate(childId, parent.token)).status).toBe(201);
        expect((await generate(childId, parent.token)).status).toBe(200);
        expect(ctx.ai.calls).toHaveLength(1);

        await ctx.prisma.planDay.update({
          where: { id: dayId },
          data: { instructions: 'Skip the story tonight; hum a lullaby instead.' },
        });
        const regenerated = await generate(childId, parent.token);
        expect(regenerated.status).toBe(201);
        expect(ctx.ai.calls).toHaveLength(2);
        expect((await ctx.prisma.aiOutput.findFirstOrThrow({ where: { childId } })).generation).toBe(2);

        await ctx.prisma.planDay.update({
          where: { id: dayId },
          data: { instructions: 'A third edit on the same day.' },
        });
        const capped = await generate(childId, parent.token);
        expect(capped.status).toBe(200);
        expect(capped.body.status).toBe('READY');
        expect(ctx.ai.calls).toHaveLength(2);
      });

      it('a failed regeneration keeps the earlier tip visible', async () => {
        const { parent, childId, dayId } = await family();
        ctx.ai.willReturn(TIP);
        await generate(childId, parent.token);
        await ctx.prisma.planDay.update({
          where: { id: dayId },
          data: { instructions: 'A new instruction from the clinician.' },
        });
        ctx.ai.willFail(new AiRunError('AI_BLOCKED'));

        const res = await generate(childId, parent.token);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'READY', tip: TIP });
        expect((await getToday(childId, parent.token)).body.tip).toEqual(TIP);
      });
    });

    describe('failures', () => {
      it('a blocked output is UNAVAILABLE/BLOCKED and stores no content', async () => {
        const { parent, childId } = await family();
        ctx.ai.willReturn({ ...TIP, body: 'Ask about the medication dose.' });

        const res = await generate(childId, parent.token);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'UNAVAILABLE', reason: 'BLOCKED', tip: null });
        const row = await ctx.prisma.aiOutput.findFirstOrThrow({ where: { childId } });
        expect(row.status).toBe(AiOutputStatus.FAILED);
        expect(row.content).toBeNull();
      });

      it('a retryable provider failure answers 202 and the job finishes the tip', async () => {
        const { parent, childId } = await family();
        ctx.ai.willFail(retryable()).willReturn(TIP);

        const res = await generate(childId, parent.token);

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({ status: 'PENDING', tip: null });
        await ctx.jobs.drain();
        const today = await getToday(childId, parent.token);
        expect(today.body).toMatchObject({ status: 'READY', tip: TIP });
        expect(ctx.ai.calls).toHaveLength(2);
      });

      it('exhausting the job attempts ends FAILED/PROVIDER, never a row stuck PENDING', async () => {
        const { parent, childId } = await family();
        for (let i = 0; i < 6; i += 1) ctx.ai.willFail(retryable());

        expect((await generate(childId, parent.token)).status).toBe(202);
        for (let i = 0; i < 4; i += 1) {
          await ctx.prisma.job.updateMany({ data: { runAt: new Date(Date.now() - 1000) } });
          await ctx.jobs.drain();
        }

        const row = await ctx.prisma.aiOutput.findFirstOrThrow({ where: { childId } });
        expect(row.status).toBe(AiOutputStatus.FAILED);
        expect(row.failureReason).toBe('PROVIDER');
        expect((await getToday(childId, parent.token)).body).toMatchObject({
          status: 'UNAVAILABLE',
          reason: 'PROVIDER',
        });
        expect(ctx.ai.calls.length).toBeLessThanOrEqual(1 + 3);
      });

      it('the job is a no-op once the tip is already READY (idempotent)', async () => {
        const { parent, childId } = await family();
        ctx.ai.willFail(retryable()).willReturn(TIP);
        await generate(childId, parent.token);
        await ctx.jobs.drain();
        const calls = ctx.ai.calls.length;

        await ctx.jobs.drain();

        expect(ctx.ai.calls).toHaveLength(calls);
      });
    });

    describe('per-user daily limit', () => {
      it('429 AI_USER_LIMIT_REACHED once the user has used their generations today', async () => {
        const { parent, childId } = await family();
        await ctx.prisma.aiRun.createMany({
          data: Array.from({ length: 3 }, () => ({
            capability: 'coaching-tip',
            promptId: 'coaching-tip',
            promptVersion: 1,
            provider: 'google',
            model: 'm',
            attempt: 1,
            status: AiRunStatus.SUCCEEDED,
            latencyMs: 10,
            userId: parent.id,
            childId,
          })),
        });

        const res = await generate(childId, parent.token);

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_USER_LIMIT_REACHED');
        expect(ctx.ai.calls).toHaveLength(0);
      });

      it('cached reads are free: a parent at the limit still gets today’s existing tip (200)', async () => {
        const { parent, childId } = await family();
        ctx.ai.willReturn(TIP);
        expect((await generate(childId, parent.token)).status).toBe(201);
        await ctx.prisma.aiRun.createMany({
          data: Array.from({ length: 3 }, () => ({
            capability: 'coaching-tip',
            promptId: 'coaching-tip',
            promptVersion: 1,
            provider: 'google',
            model: 'm',
            attempt: 1,
            status: AiRunStatus.SUCCEEDED,
            latencyMs: 10,
            userId: parent.id,
            childId,
          })),
        });

        const res = await generate(childId, parent.token);

        expect(res.status).toBe(200);
        expect(res.body.tip).toEqual(TIP);
      });
    });

    it('is throttled to 5 requests a minute per user (429 RATE_LIMITED)', async () => {
      const { parent, childId } = await family();
      ctx.ai.willReturn(TIP);

      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await generate(childId, parent.token)).status);

      expect(statuses.slice(0, 5)).toEqual([201, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);
      expect(ctx.ai.calls).toHaveLength(1);
    });
  });

  describe('GET /v1/children/:childId/ai-coaching-tips/today', () => {
    it('NONE before anything is generated', async () => {
      const { parent, childId } = await family();

      const res = await getToday(childId, parent.token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'NONE', tip: null, aiGenerated: true });
      expect(res.body.forDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('the parent, the assigned clinician and an admin all see the same tip the parent saw', async () => {
      const { parent, childId } = await family();
      ctx.ai.willReturn(TIP);
      await generate(childId, parent.token);

      for (const who of [parent, clinician, admin]) {
        const res = await getToday(childId, who.token);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'READY', tip: TIP, aiGenerated: true });
      }
      expect(ctx.ai.calls).toHaveLength(1);
    });

    it('403 for another parent and an unassigned clinician; 404 for an unknown child', async () => {
      const { childId } = await family();

      expect((await getToday(childId, otherParent.token)).status).toBe(403);
      expect((await getToday(childId, unassignedClinician.token)).status).toBe(403);
      expect(
        (await getToday('00000000-0000-4000-8000-000000000000', admin.token)).status,
      ).toBe(404);
    });

    it('401 without a token', async () => {
      const { childId } = await family();
      expect((await http().get(`/v1/children/${childId}/ai-coaching-tips/today`)).status).toBe(401);
    });
  });

  describe('when AI is disabled', () => {
    let disabled: TestContext;
    beforeAll(async () => {
      process.env.AI_ENABLED = 'false';
      disabled = await createTestApp();
    });
    afterAll(async () => {
      await disabled.close();
      process.env.AI_ENABLED = 'true';
    });

    it('POST is 503 AI_DISABLED, GET is UNAVAILABLE/DISABLED, and nothing is called or stored', async () => {
      const dhttp = () => request(disabled.app.getHttpServer());
      const passwords = disabled.app.get(PasswordService);
      const parent = await disabled.prisma.user.create({
        data: {
          email: 'ai-off-parent@example.com',
          passwordHash: await passwords.hash(password),
          name: 'p',
          role: Role.PARENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      const child = await disabled.prisma.child.create({
        data: { parentId: parent.id, name: 'Sam', dateOfBirth: new Date('2019-05-14') },
      });
      const login = await dhttp()
        .post('/v1/auth/login')
        .send({ email: 'ai-off-parent@example.com', password });
      const token = login.body.accessToken as string;

      const post = await dhttp().post(`/v1/children/${child.id}/ai-coaching-tips`).set(auth(token));
      const get = await dhttp()
        .get(`/v1/children/${child.id}/ai-coaching-tips/today`)
        .set(auth(token));

      expect(post.status).toBe(503);
      expect(post.body.code).toBe('AI_DISABLED');
      expect(get.status).toBe(200);
      expect(get.body).toMatchObject({ status: 'UNAVAILABLE', reason: 'DISABLED', tip: null });
      expect(disabled.ai.calls).toHaveLength(0);
      expect(await disabled.prisma.aiOutput.count()).toBe(0);
    });
  });
});

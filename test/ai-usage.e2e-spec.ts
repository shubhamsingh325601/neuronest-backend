import request from 'supertest';
import { AiRunStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Plan 0018 batch 3: `GET /v1/admin/ai/usage` — today's provider-request usage, ADMIN only. */
describe('Admin AI usage (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  const createLoggedInUser = async (email: string, role: Role) => {
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
  const asToken = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  let admin: { id: string; token: string };
  let parent: { id: string; token: string };
  let clinician: { id: string; token: string };

  const run = (status: AiRunStatus, extra: Record<string, unknown> = {}) =>
    ctx.prisma.aiRun.create({
      data: {
        capability: 'coaching-tip',
        promptId: 'coaching-tip',
        promptVersion: 1,
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        attempt: 1,
        status,
        latencyMs: 900,
        ...extra,
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    [admin, parent, clinician] = await Promise.all([
      createLoggedInUser('usage-admin@example.com', Role.ADMIN),
      createLoggedInUser('usage-parent@example.com', Role.PARENT),
      createLoggedInUser('usage-clinician@example.com', Role.CLINICIAN),
    ]);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('rejects anonymous, parent and clinician callers', async () => {
    expect((await http().get('/v1/admin/ai/usage')).status).toBe(401);

    for (const caller of [parent, clinician]) {
      const res = await asToken(caller.token)(http().get('/v1/admin/ai/usage'));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    }
  });

  it('reports an empty day as zeros with the configured budget', async () => {
    const res = await asToken(admin.token)(http().get('/v1/admin/ai/usage'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      requestsUsed: 0,
      requestBudget: expect.any(Number),
      tokens: { input: 0, output: 0 },
      costEstimateMicroUsd: 0,
      byModel: [],
      errorsByClass: [],
    });
    expect(res.body.requestBudget).toBeGreaterThan(0);
    expect(res.body.requestsByStatus.SUCCEEDED).toBe(0);
  });

  it("counts today's runs, keeps rejected-by-budget out of spend, and ignores yesterday", async () => {
    await run(AiRunStatus.SUCCEEDED, { inputTokens: 100, outputTokens: 60, costEstimateMicroUsd: 180 });
    await run(AiRunStatus.SUCCEEDED, { inputTokens: 90, outputTokens: 40, costEstimateMicroUsd: 127 });
    await run(AiRunStatus.PROVIDER_ERROR, {
      attempt: 2,
      model: 'gemini-3.1-flash-lite',
      errorClass: 'APICallError',
      httpStatus: 503,
    });
    await run(AiRunStatus.REJECTED_BUDGET);
    await run(AiRunStatus.SUCCEEDED, {
      inputTokens: 5000,
      outputTokens: 5000,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    const res = await asToken(admin.token)(http().get('/v1/admin/ai/usage'));

    expect(res.status).toBe(200);
    expect(res.body.requestsUsed).toBe(3);
    expect(res.body.requestsByStatus).toMatchObject({
      SUCCEEDED: 2,
      PROVIDER_ERROR: 1,
      REJECTED_BUDGET: 1,
      BLOCKED: 0,
    });
    expect(res.body.tokens).toEqual({ input: 190, output: 100 });
    expect(res.body.costEstimateMicroUsd).toBe(307);
    expect(res.body.byModel).toEqual([
      {
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        requests: 2,
        inputTokens: 190,
        outputTokens: 100,
      },
      {
        provider: 'google',
        model: 'gemini-3.1-flash-lite',
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
      },
    ]);
    expect(res.body.errorsByClass).toEqual([{ errorClass: 'APICallError', count: 1 }]);
  });
});

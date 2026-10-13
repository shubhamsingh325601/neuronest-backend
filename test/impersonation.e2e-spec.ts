import request from 'supertest';
import { PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { AccessTokenService } from '@common/authz/access-token.service';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';
import { SseClient } from './helpers/sse-client';

/**
 * TEMPORARY testing aid: an admin acts as a parent (admin site testing). Covers the safeguards and
 * proves the parent features really work with the minted token.
 */
describe('Admin impersonation (e2e)', () => {
  const password = 'a-strong-passphrase';
  const missingId = '11111111-1111-4111-8111-111111111111';
  const saved: Record<string, string | undefined> = {};
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const setEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  };
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  type U = { id: string; token: string };
  const makeUsers = async (ctx: TestContext) => {
    const http = () => request(ctx.app.getHttpServer());
    const create = async (email: string, role: Role, status: UserStatus = UserStatus.ACTIVE) => {
      const user = await ctx.prisma.user.create({
        data: {
          email,
          passwordHash: await ctx.app.get(PasswordService).hash(password),
          name: `${role} Person`,
          role,
          status,
          emailVerifiedAt: new Date(),
        },
      });
      const login = await http().post('/v1/auth/login').send({ email, password });
      return { id: user.id, token: (login.body.accessToken as string) ?? '' } as U;
    };
    return { http, create };
  };

  describe('switched on', () => {
    let ctx: TestContext;
    let http: () => ReturnType<typeof request>;
    let admin: U;
    let parent: U;
    let expert: U;
    let clinician: U;
    let childId: string;
    let baseUrl: string;

    beforeAll(async () => {
      setEnv({
        IMPERSONATION_ENABLED: 'true',
        IMPERSONATION_TTL_MIN: '30',
        AI_ENABLED: 'true',
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-key-never-sent',
      });
      ctx = await createTestApp();
      await ctx.app.listen(0);
      baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as { port: number }).port}`;
      const users = await makeUsers(ctx);
      http = users.http;
      admin = await users.create('imp-admin@example.com', Role.ADMIN);
      parent = await users.create('imp-parent@example.com', Role.PARENT);
      expert = await users.create('imp-expert@example.com', Role.EXPERT);
      clinician = await users.create('imp-clinician@example.com', Role.CLINICIAN);

      childId = (
        await ctx.prisma.child.create({
          data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
        })
      ).id;
      await ctx.prisma.expertChildAssignment.create({ data: { expertId: expert.id, childId } });
      const template = await ctx.prisma.planTemplate.create({
        data: { title: 'Sleep', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
      });
      const plan = await ctx.prisma.plan.create({
        data: {
          childId,
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
    });
    afterAll(async () => {
      await ctx.close();
      restoreEnv();
    });
    beforeEach(() => ctx.ai.reset());

    const impersonate = (token: string, id: string) =>
      http().post(`/v1/users/${id}/impersonate`).set(auth(token)).send();

    it('mints a token for a parent: shape, lifetime from config, and the admin named', async () => {
      const res = await impersonate(admin.token, parent.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        expiresIn: 1800,
        user: { id: parent.id, role: 'PARENT', email: 'imp-parent@example.com' },
        impersonatedBy: admin.id,
      });
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body).not.toHaveProperty('refreshToken');
    });

    it('the token acts as the parent on the parent routes (an admin token itself cannot)', async () => {
      const token = (await impersonate(admin.token, parent.id)).body.accessToken as string;

      const me = await http().get('/v1/users/me').set(auth(token));
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: parent.id, role: 'PARENT' });

      const children = await http().get('/v1/children').set(auth(token));
      expect(children.status).toBe(200);
      expect(JSON.stringify(children.body)).toContain(childId);

      // Guided AI chat: the admin is refused, the impersonated parent chats.
      const asAdmin = await http().get('/v1/ai-chat/topics').set(auth(admin.token));
      expect(asAdmin.status).toBe(403);
      expect((await http().get('/v1/ai-chat/topics').set(auth(token))).status).toBe(200);
      const chat = await http()
        .post(`/v1/children/${childId}/ai-conversations`)
        .set(auth(token))
        .send({ topic: 'TODAYS_ACTIVITIES' });
      expect(chat.status).toBe(201);
      ctx.ai.willStreamChat({ deltas: ['Start with the story. ', 'Keep the lights low. '] });
      const reply = await http()
        .post(`/v1/ai-conversations/${chat.body.id}/messages`)
        .set(auth(token))
        .send({ text: 'How do I do tonight?', clientMessageId: 'imp-1' });
      expect(reply.status).toBe(200);
      expect(reply.text).toContain('event: done');
    });

    it('works for the chat with an expert, live events included', async () => {
      const token = (await impersonate(admin.token, parent.id)).body.accessToken as string;
      const created = await http()
        .post(`/v1/children/${childId}/conversations`)
        .set(auth(token))
        .send();
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const stream = await SseClient.open(`${baseUrl}/v1/conversations/${id}/events`, {
        ...auth(expert.token),
      });
      expect(stream.status).toBe(200);
      const sent = await http()
        .post(`/v1/conversations/${id}/messages`)
        .set(auth(token))
        .send({ text: 'Hello from the admin site', clientMessageId: 'imp-h1' });
      expect(sent.status).toBe(201);
      expect(sent.body.sender).toBe('PARENT');

      await stream.waitFor(() => stream.seqs().length === 1);
      stream.close();
    });

    it('cannot change the password or deactivate the account while acting as the parent', async () => {
      const token = (await impersonate(admin.token, parent.id)).body.accessToken as string;

      const change = await http()
        .post('/v1/auth/change-password')
        .set(auth(token))
        .send({ currentPassword: password, newPassword: 'another-strong-passphrase' });
      expect(change.status).toBe(403);
      expect(change.body.code).toBe('IMPERSONATION_RESTRICTED');
      const deactivate = await http().post('/v1/users/me/deactivate').set(auth(token)).send();
      expect(deactivate.status).toBe(403);
      expect(deactivate.body.code).toBe('IMPERSONATION_RESTRICTED');

      expect(
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: parent.id } })).status,
      ).toBe(UserStatus.ACTIVE);
    });

    it('is for admins only', async () => {
      for (const who of [parent, expert, clinician]) {
        expect((await impersonate(who.token, parent.id)).status).toBe(403);
      }
      expect((await http().post(`/v1/users/${parent.id}/impersonate`)).status).toBe(401);
    });

    it('a minted token cannot mint another one, even for itself', async () => {
      const token = (await impersonate(admin.token, parent.id)).body.accessToken as string;
      expect((await impersonate(token, parent.id)).status).toBe(403);
    });

    it('parents only, and only active ones', async () => {
      const suspended = await ctx.prisma.user.create({
        data: {
          email: 'imp-suspended@example.com',
          passwordHash: 'x',
          name: 'Sus Pended',
          role: Role.PARENT,
          status: UserStatus.SUSPENDED,
        },
      });

      for (const target of [admin, expert, clinician]) {
        const res = await impersonate(admin.token, target.id);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('IMPERSONATION_TARGET_NOT_ALLOWED');
      }
      const inactive = await impersonate(admin.token, suspended.id);
      expect(inactive.status).toBe(409);
      expect(inactive.body.code).toBe('ACCOUNT_NOT_ACTIVE');
      expect((await impersonate(admin.token, missingId)).status).toBe(404);
      expect((await impersonate(admin.token, 'not-a-uuid')).status).toBe(400);
    });

    it('stops working at once if the admin is deactivated', async () => {
      const second = await (await makeUsers(ctx)).create('imp-admin2@example.com', Role.ADMIN);
      const token = (await impersonate(second.token, parent.id)).body.accessToken as string;
      expect((await http().get('/v1/users/me').set(auth(token))).status).toBe(200);

      await ctx.prisma.user.update({
        where: { id: second.id },
        data: { status: UserStatus.DEACTIVATED },
      });

      const after = await http().get('/v1/users/me').set(auth(token));
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('INVALID_TOKEN');
    });

    it('stops working if the parent account is suspended', async () => {
      const other = await (await makeUsers(ctx)).create('imp-parent2@example.com', Role.PARENT);
      const token = (await impersonate(admin.token, other.id)).body.accessToken as string;

      await ctx.prisma.user.update({
        where: { id: other.id },
        data: { status: UserStatus.SUSPENDED },
      });

      expect((await http().get('/v1/users/me').set(auth(token))).status).toBe(403);
    });
  });

  describe('switched off (the default)', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      setEnv({ IMPERSONATION_ENABLED: 'false' });
      ctx = await createTestApp();
    });
    afterAll(async () => {
      await ctx.close();
      restoreEnv();
    });

    it('is a 404 IMPERSONATION_DISABLED and mints nothing', async () => {
      const { http, create } = await makeUsers(ctx);
      const admin = await create('off-admin@example.com', Role.ADMIN);
      const parent = await create('off-parent@example.com', Role.PARENT);

      const res = await http().post(`/v1/users/${parent.id}/impersonate`).set(auth(admin.token));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('IMPERSONATION_DISABLED');
    });

    it('a token carrying the impersonation claim is refused', async () => {
      const { http, create } = await makeUsers(ctx);
      const admin = await create('off-admin2@example.com', Role.ADMIN);
      const parent = await create('off-parent2@example.com', Role.PARENT);
      const forged = await ctx.app
        .get(AccessTokenService)
        .issue(
          { id: parent.id, email: 'off-parent2@example.com', role: Role.PARENT, status: UserStatus.ACTIVE },
          { impersonatedBy: admin.id },
        );

      const res = await http().get('/v1/users/me').set(auth(forged.accessToken));

      expect(res.status).toBe(401);
    });
  });
});

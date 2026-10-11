import request from 'supertest';
import { PlanStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Expert role (plan 0019 batch 2): admin lifecycle, assignment sets, read-only access matrix. */
describe('Expert role (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const missingId = '11111111-1111-4111-8111-111111111111';

  const createLoggedInUser = async (email: string, role: Role) => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (path: string, token: string) => http().get(`/v1${path}`).set(auth(token));

  type U = { id: string; token: string };
  let admin: U;
  let parent: U;
  let otherParent: U;
  let clinician: U;
  let expert: U; // assigned to childId
  let strangerExpert: U; // assigned to nobody
  let childId: string;
  let otherChildId: string;
  let planId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createLoggedInUser('ex-admin@example.com', Role.ADMIN);
    parent = await createLoggedInUser('ex-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('ex-parent2@example.com', Role.PARENT);
    clinician = await createLoggedInUser('ex-clinician@example.com', Role.CLINICIAN);
    expert = await createLoggedInUser('ex-expert@example.com', Role.EXPERT);
    strangerExpert = await createLoggedInUser('ex-stranger@example.com', Role.EXPERT);

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
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
    const template = await ctx.prisma.planTemplate.create({
      data: { title: 'Starter', status: 'PUBLISHED', createdById: admin.id },
    });
    planId = (
      await ctx.prisma.plan.create({
        data: {
          childId,
          planTemplateId: template.id,
          startDate: new Date(),
          createdById: clinician.id,
          status: PlanStatus.ACTIVE,
        },
      })
    ).id;

    const set = await http()
      .put(`/v1/experts/${expert.id}/children`)
      .set(auth(admin.token))
      .send({ childIds: [childId] });
    expect(set.status).toBe(200);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('admin lifecycle (created directly, no invitation)', () => {
    it('create → ACTIVE at once → logs in with the admin-set password as EXPERT', async () => {
      ctx.mail.clear();
      const res = await http()
        .post('/v1/experts')
        .set(auth(admin.token))
        .send({ name: 'Priya Nair', email: 'New.Expert@Example.com', password: 'first-strong-passphrase' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: 'new.expert@example.com',
        status: 'ACTIVE',
        lastLoginAt: null,
        assignedChildIds: [],
      });
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(ctx.mail.lastSetupUrlFor('new.expert@example.com')).toBeFalsy();

      const login = await http()
        .post('/v1/auth/login')
        .send({ email: 'new.expert@example.com', password: 'first-strong-passphrase' });
      expect(login.status).toBe(200);
      expect((await get('/users/me', login.body.accessToken)).body.role).toBe('EXPERT');
    });

    it('validates the create body and 409s a duplicate email', async () => {
      const post = (body: object) => http().post('/v1/experts').set(auth(admin.token)).send(body);
      expect((await post({ name: 'X', email: 'ex-clinician@example.com', password: 'long-enough-pass' })).status).toBe(409);
      expect((await post({ name: 'X', email: 'short@example.com', password: 'short' })).status).toBe(400);
      expect((await post({ name: 'X', email: 'noPw@example.com' })).status).toBe(400);
    });

    it('admin password reset signs the expert out and replaces the password', async () => {
      const created = await http()
        .post('/v1/experts')
        .set(auth(admin.token))
        .send({ name: 'Reset Me', email: 'reset.me@example.com', password: 'old-strong-passphrase' });
      const login = await http()
        .post('/v1/auth/login')
        .send({ email: 'reset.me@example.com', password: 'old-strong-passphrase' });
      const oldRefresh = login.body.refreshToken as string;

      const reset = await http()
        .post(`/v1/experts/${created.body.id}/reset-password`)
        .set(auth(admin.token))
        .send({ newPassword: 'new-strong-passphrase' });
      expect(reset.status).toBe(204);

      // The old refresh token no longer works, so the expert cannot stay signed in.
      expect((await http().post('/v1/auth/refresh').send({ refreshToken: oldRefresh })).status).toBe(401);
      expect(
        (await http().post('/v1/auth/login').send({ email: 'reset.me@example.com', password: 'old-strong-passphrase' })).status,
      ).toBe(401);
      const again = await http()
        .post('/v1/auth/login')
        .send({ email: 'reset.me@example.com', password: 'new-strong-passphrase' });
      expect(again.status).toBe(200);

      expect(
        (await http().post(`/v1/experts/${created.body.id}/reset-password`).set(auth(admin.token)).send({ newPassword: 'short' })).status,
      ).toBe(400);
      // A clinician id is not an expert.
      expect(
        (await http().post(`/v1/experts/${clinician.id}/reset-password`).set(auth(admin.token)).send({ newPassword: 'new-strong-passphrase' })).status,
      ).toBe(404);
    });

    it('lists, gets and updates name and email; a taken email is 409', async () => {
      const list = await get('/experts?q=ex-expert', admin.token);
      expect(list.status).toBe(200);
      expect(list.body.data.map((e: { id: string }) => e.id)).toContain(expert.id);

      const detail = await get(`/experts/${expert.id}`, admin.token);
      expect(detail.body.assignedChildIds).toEqual([childId]);

      const renamed = await http()
        .patch(`/v1/experts/${expert.id}`)
        .set(auth(admin.token))
        .send({ name: 'Renamed' });
      expect(renamed.body.name).toBe('Renamed');
      const taken = await http()
        .patch(`/v1/experts/${expert.id}`)
        .set(auth(admin.token))
        .send({ email: 'ex-clinician@example.com' });
      expect(taken.status).toBe(409);
      const moved = await http()
        .patch(`/v1/experts/${expert.id}`)
        .set(auth(admin.token))
        .send({ email: 'ex-expert@example.com' });
      expect(moved.status).toBe(200);
      expect((await get(`/experts/${missingId}`, admin.token)).status).toBe(404);
    });

    it('is admin only: parent, clinician and expert get 403 on every management route', async () => {
      for (const who of [parent, clinician, expert]) {
        const calls = [
          get('/experts', who.token),
          get(`/experts/${expert.id}`, who.token),
          http().post('/v1/experts').set(auth(who.token)).send({ name: 'x', email: 'x@example.com', password: 'long-enough-pass' }),
          http().patch(`/v1/experts/${expert.id}`).set(auth(who.token)).send({ name: 'x' }),
          http().post(`/v1/experts/${expert.id}/reset-password`).set(auth(who.token)).send({ newPassword: 'long-enough-pass' }),
          http().put(`/v1/experts/${expert.id}/children`).set(auth(who.token)).send({ childIds: [] }),
          get(`/experts/${expert.id}/children`, who.token),
          get(`/children/${childId}/experts`, who.token),
        ];
        for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
      }
    });
  });

  describe('assignment sets', () => {
    it('replaces the set as a diff, and GET shows it from both sides', async () => {
      const second = await http()
        .put(`/v1/experts/${strangerExpert.id}/children`)
        .set(auth(admin.token))
        .send({ childIds: [childId, otherChildId] });
      expect(second.body.map((r: { childId: string }) => r.childId).sort()).toEqual(
        [childId, otherChildId].sort(),
      );

      const both = await get(`/children/${childId}/experts`, admin.token);
      expect(both.body.map((r: { expertId: string }) => r.expertId).sort()).toEqual(
        [expert.id, strangerExpert.id].sort(),
      );

      const shrink = await http()
        .put(`/v1/experts/${strangerExpert.id}/children`)
        .set(auth(admin.token))
        .send({ childIds: [] });
      expect(shrink.body).toEqual([]);
      expect((await get(`/experts/${strangerExpert.id}/children`, admin.token)).body).toEqual([]);
    });

    it('validates: unknown child 404, duplicate ids 400, non-uuid 400, non-expert 404', async () => {
      const put = (id: string, body: unknown) =>
        http().put(`/v1/experts/${id}/children`).set(auth(admin.token)).send(body as object);
      expect((await put(expert.id, { childIds: [missingId] })).status).toBe(404);
      expect((await put(expert.id, { childIds: [childId, childId] })).status).toBe(400);
      expect((await put(expert.id, { childIds: ['nope'] })).status).toBe(400);
      expect((await put(clinician.id, { childIds: [] })).status).toBe(404);
      // The failed calls changed nothing.
      expect((await get(`/experts/${expert.id}/children`, admin.token)).body).toHaveLength(1);
    });
  });

  describe('read-only access matrix', () => {
    const readRoutes = (cid: string) => [
      `/children/${cid}`,
      `/children/${cid}/care-plan`,
      `/children/${cid}/plans`,
      `/children/${cid}/plans/today`,
      `/children/${cid}/progress`,
      `/children/${cid}/progress/weekly-summary`,
      `/children/${cid}/appointments`,
      `/children/${cid}/coaching`,
    ];

    it('an assigned expert can read the assigned child on every read route', async () => {
      for (const path of readRoutes(childId)) {
        const res = await get(path, expert.token);
        expect([path, res.status]).toEqual([path, 200]);
      }
      expect((await get(`/plans/${planId}`, expert.token)).status).toBe(200);
      expect((await get('/appointments', expert.token)).status).toBe(200);
    });

    it('an unassigned expert gets 403 on the same routes', async () => {
      for (const path of readRoutes(childId)) {
        const res = await get(path, strangerExpert.token);
        expect([path, res.status]).toEqual([path, 403]);
      }
      expect((await get(`/plans/${planId}`, strangerExpert.token)).status).toBe(403);
    });

    it('the expert child list shows only assigned children; the clinician list is closed to experts', async () => {
      const list = await get('/children', expert.token);
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([childId]);
      expect((await get('/children', strangerExpert.token)).body.data).toEqual([]);
      expect((await get(`/children/${childId}/clinicians`, expert.token)).status).toBe(403);
      // Another family's child stays closed even though the expert is assigned elsewhere.
      expect((await get(`/children/${otherChildId}`, expert.token)).status).toBe(403);
    });

    it('the expert has no write or restricted-read access', async () => {
      const day = new Date().toISOString().slice(0, 10);
      const results = await Promise.all([
        http().put(`/v1/children/${childId}/progress/${day}`).set(auth(expert.token)).send({ mood: 3 }),
        http().patch(`/v1/children/${childId}`).set(auth(expert.token)).send({ name: 'Z' }),
        http().put(`/v1/children/${childId}/clinical-profile`).set(auth(expert.token)).send({}),
        get(`/children/${childId}/media`, expert.token),
        get(`/children/${childId}/plan-notes`, expert.token),
        get(`/children/${childId}/consent`, expert.token),
        get(`/children/${childId}/ai-coaching-tip`, expert.token),
      ]);
      for (const res of results) expect([401, 403, 404, 405]).toContain(res.status);
      expect(results.slice(0, 2).map((r) => r.status)).toEqual([403, 403]);
    });

    it('experts read the appointment list filtered to their children', async () => {
      const own = await get('/appointments', strangerExpert.token);
      expect(own.status).toBe(200);
      expect(own.body.data).toEqual([]);
    });
  });

  describe('GET /children/{childId}/parent-contact', () => {
    it('gives name and email to the assigned expert and to admin', async () => {
      for (const who of [expert, admin]) {
        const res = await get(`/children/${childId}/parent-contact`, who.token);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ name: 'PARENT', email: 'ex-parent@example.com' });
      }
    });

    it('refuses an unassigned expert, the clinician and the parent', async () => {
      for (const who of [strangerExpert, clinician, parent]) {
        expect((await get(`/children/${childId}/parent-contact`, who.token)).status).toBe(403);
      }
    });

    it('404s an unknown child and 401s without a token', async () => {
      expect((await get(`/children/${missingId}/parent-contact`, admin.token)).status).toBe(404);
      expect((await http().get(`/v1/children/${childId}/parent-contact`)).status).toBe(401);
    });
  });
});

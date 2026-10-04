import request from 'supertest';
import { PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

const DAY_MS = 86_400_000;
const isoDay = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
/** Monday (UTC) of the week containing the given YYYY-MM-DD. */
const mondayOf = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
};
const addDays = (day: string, n: number): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

describe('Child progress tracking (e2e)', () => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let parent: { id: string; token: string };
  let otherParent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let otherClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;

  const put = (day: string, token: string, body: unknown, id = childId) =>
    http().put(`/v1/children/${id}/progress/${day}`).set(auth(token)).send(body as object);
  const list = (token: string, qs = '') =>
    http().get(`/v1/children/${childId}/progress${qs}`).set(auth(token));
  const summary = (token: string, qs = '') =>
    http().get(`/v1/children/${childId}/progress/weekly-summary${qs}`).set(auth(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, otherClinician, admin] = await Promise.all([
      createLoggedInUser('prog-parent@example.com', Role.PARENT),
      createLoggedInUser('prog-other@example.com', Role.PARENT),
      createLoggedInUser('prog-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('prog-other-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('prog-admin@example.com', Role.ADMIN),
    ]);
    const child = await ctx.prisma.child.create({
      data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    childId = child.id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('a new child with NO plan can log; planId is null; 201 then 200 on the same date (one row)', async () => {
    const day = isoDay(3);
    const first = await put(day, parent.token, { mood: 4, behaviour: 3, sleepMinutes: 500 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      childId,
      entryDate: day,
      planId: null,
      mood: 4,
      behaviour: 3,
      sleepMinutes: 500,
      note: null,
    });
    const second = await put(day, parent.token, { mood: 5, note: 'Better day' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ mood: 5, behaviour: null, sleepMinutes: null, note: 'Better day' });
    expect(second.body.id).toBe(first.body.id);
    expect(await ctx.prisma.progressEntry.count({ where: { childId } })).toBe(1);
  });

  it('planId is stamped from the ACTIVE plan at first write and kept after the plan completes', async () => {
    const template = await ctx.prisma.planTemplate.create({
      data: { title: 'Speech', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
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
    const day = isoDay(2);
    const created = await put(day, parent.token, { mood: 3 });
    expect(created.status).toBe(201);
    expect(created.body.planId).toBe(plan.id);

    // The earlier no-plan entry is untouched.
    const earlier = await ctx.prisma.progressEntry.findFirst({ where: { childId, planId: null } });
    expect(earlier).not.toBeNull();

    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { status: PlanStatus.COMPLETED } });
    const updated = await put(day, parent.token, { mood: 2 });
    expect(updated.status).toBe(200);
    expect(updated.body.planId).toBe(plan.id);
  });

  it('rejects out-of-range values, an empty body, unknown fields, a future date and a too-old date (400)', async () => {
    const day = isoDay(1);
    for (const body of [
      { mood: 0 },
      { mood: 6 },
      { behaviour: 9 },
      { sleepMinutes: -1 },
      { sleepMinutes: 1441 },
      { mood: 2.5 },
      { note: 'x'.repeat(1001) },
      {},
      { mood: 3, bogus: true },
    ]) {
      const res = await put(day, parent.token, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await put(addDays(isoDay(0), 3), parent.token, { mood: 3 })).status).toBe(400);
    expect((await put('2026-02-30', parent.token, { mood: 3 })).status).toBe(400);
    expect((await put(isoDay(31), parent.token, { mood: 3 })).status).toBe(400);
    expect((await put(isoDay(30), parent.token, { mood: 3 })).status).toBe(201);
  });

  it('only the child\'s own parent may write: other parent, clinician and admin get 403; unknown child 404', async () => {
    const day = isoDay(1);
    for (const who of [otherParent, clinician, admin]) {
      expect((await put(day, who.token, { mood: 3 })).status).toBe(403);
    }
    const missing = await put(day, parent.token, { mood: 3 }, '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('CHILD_NOT_FOUND');
    expect((await http().put(`/v1/children/${childId}/progress/${day}`).send({ mood: 3 })).status).toBe(401);
  });

  it('history is newest-first, paginated by cursor, and filterable with from/to', async () => {
    const before = await list(parent.token);
    expect(before.status).toBe(200);
    const dates = before.body.data.map((e: { entryDate: string }) => e.entryDate);
    expect(dates).toEqual([...dates].sort().reverse());

    const page1 = await list(parent.token, '?limit=2');
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await list(parent.token, `?limit=2&cursor=${page1.body.nextCursor}`);
    const all = await list(parent.token, '?limit=100');
    expect([...page1.body.data, ...page2.body.data].map((e: { id: string }) => e.id)).toEqual(
      all.body.data.slice(0, 2 + page2.body.data.length).map((e: { id: string }) => e.id),
    );

    const ranged = await list(parent.token, `?from=${isoDay(2)}&to=${isoDay(2)}`);
    expect(ranged.body.data.map((e: { entryDate: string }) => e.entryDate)).toEqual([isoDay(2)]);
    expect((await list(parent.token, '?from=not-a-date')).status).toBe(400);
    expect((await list(parent.token, '?cursor=garbage')).body.code).toBe('INVALID_CURSOR');
  });

  it('read scoping: own parent, assigned clinician and admin read; other parent and unassigned clinician get 403', async () => {
    for (const who of [parent, clinician, admin]) {
      expect((await list(who.token)).status).toBe(200);
      expect((await summary(who.token)).status).toBe(200);
    }
    for (const who of [otherParent, otherClinician]) {
      expect((await list(who.token)).status).toBe(403);
      expect((await summary(who.token)).status).toBe(403);
    }
  });

  describe('weekly summary', () => {
    it('a week with no entries is 200 with zeros/nulls (never 404)', async () => {
      const lonely = await ctx.prisma.child.create({
        data: { parentId: otherParent.id, name: 'Sam', dateOfBirth: new Date('2020-01-01') },
      });
      const res = await http()
        .get(`/v1/children/${lonely.id}/progress/weekly-summary`)
        .set(auth(otherParent.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        daysLogged: 0,
        trend: null,
        activePlan: null,
        mood: { average: null, min: null, max: null },
      });
    });

    it('computes aggregates and trend for the default previous full week', async () => {
      const lastWeek = addDays(mondayOf(isoDay(0)), -7);
      const priorWeek = addDays(lastWeek, -7);
      // Prior week: low. Last week: high.
      await put(addDays(priorWeek, 0), parent.token, { mood: 2, behaviour: 2, sleepMinutes: 400 });
      await put(addDays(lastWeek, 0), parent.token, { mood: 4, behaviour: 4, sleepMinutes: 480 });
      await put(addDays(lastWeek, 2), parent.token, { mood: 5, behaviour: 3, sleepMinutes: 540 });
      await put(addDays(lastWeek, 6), parent.token, { note: 'note only' });

      const res = await summary(parent.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        weekStart: lastWeek,
        weekEnd: addDays(lastWeek, 6),
        daysLogged: 3,
        mood: { average: 4.5, min: 4, max: 5 },
        behaviour: { average: 3.5, min: 3, max: 4 },
        sleepMinutes: { average: 510, min: 480, max: 540 },
        trend: 'UP',
      });

      // Any date in the week normalises to its Monday.
      const viaWednesday = await summary(clinician.token, `?weekStart=${addDays(lastWeek, 2)}`);
      expect(viaWednesday.body.weekStart).toBe(lastWeek);
      expect(viaWednesday.body.daysLogged).toBe(3);

      // The prior week itself has no earlier data to compare with.
      const prior = await summary(admin.token, `?weekStart=${priorWeek}`);
      expect(prior.body).toMatchObject({ daysLogged: 1, trend: null });
    });

    it('rejects a bad weekStart', async () => {
      expect((await summary(parent.token, '?weekStart=nope')).status).toBe(400);
    });
  });
});

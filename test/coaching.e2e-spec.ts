import request from 'supertest';
import { PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Manual weekly coaching (e2e)', () => {
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
  let planId: string;
  const put = (week: number, token: string, tips: unknown) =>
    http().put(`/v1/plans/${planId}/coaching/${week}`).set(auth(token)).send({ tips });
  const list = (token: string, qs = '') =>
    http().get(`/v1/children/${childId}/coaching${qs}`).set(auth(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, otherClinician, admin] = await Promise.all([
      createLoggedInUser('coach-parent@example.com', Role.PARENT),
      createLoggedInUser('coach-other@example.com', Role.PARENT),
      createLoggedInUser('coach-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('coach-other-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('coach-admin@example.com', Role.ADMIN),
    ]);
    const child = await ctx.prisma.child.create({
      data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    childId = child.id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
    const template = await ctx.prisma.planTemplate.create({
      data: { title: 'T', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
    });
    // Started 9 days ago (UTC) → today is plan day 10 → week 2.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 9);
    const plan = await ctx.prisma.plan.create({
      data: {
        childId,
        planTemplateId: template.id,
        startDate: start,
        createdById: admin.id,
        status: PlanStatus.ACTIVE,
      },
    });
    planId = plan.id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('a parent with a plan but no tips gets an empty list', async () => {
    const res = await list(parent.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weekNumber: 2, tips: [] });
  });

  it('admin replace is idempotent (twice → same rows)', async () => {
    const tips = [
      { title: 'Routine', body: 'Keep bedtime steady.' },
      { title: 'Praise', body: 'Name the behaviour.' },
    ];
    const first = await put(2, admin.token, tips);
    expect(first.status).toBe(200);
    const second = await put(2, admin.token, tips);
    expect(second.status).toBe(200);
    expect(await ctx.prisma.coachingTip.count({ where: { planId, weekNumber: 2 } })).toBe(2);
    expect(second.body.tips.map((t: { position: number }) => t.position)).toEqual([1, 2]);
  });

  it('week=current resolves to the right week and omits authorId for the parent', async () => {
    await put(1, admin.token, [{ title: 'Week one', body: 'x' }]);
    const res = await list(parent.token, '?week=current');
    expect(res.status).toBe(200);
    expect(res.body.weekNumber).toBe(2);
    expect(res.body.tips.map((t: { title: string }) => t.title)).toEqual(['Routine', 'Praise']);
    expect(res.body.tips[0]).not.toHaveProperty('authorId');

    const explicit = await list(parent.token, '?week=1');
    expect(explicit.body.tips[0].title).toBe('Week one');
  });

  it('staff see authorId', async () => {
    const res = await list(admin.token);
    expect(res.body.tips[0].authorId).toBe(admin.id);
  });

  it('a week outside the plan is an empty list, not an error', async () => {
    const res = await list(parent.token, '?week=40');
    expect(res.status).toBe(200);
    expect(res.body.tips).toEqual([]);
  });

  it('rejects a malformed week and an invalid body', async () => {
    expect((await list(parent.token, '?week=abc')).status).toBe(400);
    expect((await put(2, admin.token, Array(6).fill({ title: 't', body: 'b' }))).status).toBe(400);
    expect((await put(2, admin.token, [{ title: '', body: 'b' }])).status).toBe(400);
  });

  it('assigned clinician can author and read; unassigned clinician gets 403', async () => {
    expect((await put(3, clinician.token, [{ title: 'C', body: 'c' }])).status).toBe(200);
    expect((await list(clinician.token)).status).toBe(200);
    expect((await put(3, otherClinician.token, [])).status).toBe(403);
    expect((await list(otherClinician.token)).status).toBe(403);
  });

  it('parents cannot author; other parents cannot read', async () => {
    expect((await put(2, parent.token, [])).status).toBe(403);
    expect((await list(otherParent.token)).status).toBe(403);
  });

  it('an empty tips array clears the week', async () => {
    expect((await put(2, admin.token, [])).status).toBe(200);
    expect((await list(parent.token)).body.tips).toEqual([]);
  });

  it('404s for an unknown plan or child', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const p = await http().put(`/v1/plans/${missing}/coaching/1`).set(auth(admin.token)).send({ tips: [] });
    expect(p.status).toBe(404);
    expect(p.body.code).toBe('PLAN_NOT_FOUND');
    const c = await http().get(`/v1/children/${missing}/coaching`).set(auth(admin.token));
    expect(c.status).toBe(404);
  });

  it('a completed plan drops out of the parent current view but stays readable by plan id', async () => {
    await put(2, admin.token, [{ title: 'Keep', body: 'k' }]);
    await ctx.prisma.plan.update({ where: { id: planId }, data: { status: PlanStatus.COMPLETED } });
    expect((await list(parent.token)).body).toEqual({ weekNumber: null, tips: [] });
    expect(await ctx.prisma.coachingTip.count({ where: { planId } })).toBeGreaterThan(0);
    expect((await put(2, admin.token, [{ title: 'Edit', body: 'e' }])).status).toBe(200);
  });
});

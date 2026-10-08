import request from 'supertest';
import { PlanStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Structured care plan (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  const createLoggedInUser = async (email: string, role: Role, name: string = role) => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name,
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
  let strangerClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;
  let planId: string;

  const activity = (title: string, dayOfWeek: number) => ({
    dayOfWeek,
    title,
    shortDescription: 'Say each step in three words.',
    goalCategory: 'Language Goal',
    domain: 'Expressive Communication',
    durationMinutes: 5,
    whyItMatters: 'Builds spontaneous speech.',
    steps: [{ title: 'Model', instruction: 'Say "Brush teeth now".', tip: 'Keep it calm' }],
    parentScript: {
      title: 'Try saying',
      scriptQuote: 'Socks on',
      tip: 'Pause',
      context: 'Morning',
    },
    equipment: ['Visual timer'],
  });
  const week = (activities: ReturnType<typeof activity>[]) => ({
    title: 'Expressive 3-Word Requests',
    focus: 'Ask for things using three words',
    guidance: {
      title: 'Snack time',
      scriptSnippet: 'I want juice',
      practicalTip: 'Wait 5 seconds',
      context: 'Meals',
    },
    goals: [
      { title: '3-Word Speech', description: 'Combine words', domain: 'Language', icon: 'target' },
    ],
    activities,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, strangerClinician, admin] = await Promise.all([
      createLoggedInUser('cp-parent@example.com', Role.PARENT),
      createLoggedInUser('cp-other@example.com', Role.PARENT),
      createLoggedInUser('cp-clinician@example.com', Role.CLINICIAN, 'Dr. E. Okafor'),
      createLoggedInUser('cp-stranger@example.com', Role.CLINICIAN),
      createLoggedInUser('cp-admin@example.com', Role.ADMIN),
    ]);
    const child = await ctx.prisma.child.create({
      data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    childId = child.id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
    const template = await ctx.prisma.planTemplate.create({
      data: { title: 'Starter', status: 'PUBLISHED', createdById: admin.id },
    });
    // 8 days ago => day 9 => week 2, day 2.
    const start = new Date(Date.now() - 8 * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);
    const plan = await ctx.prisma.plan.create({
      data: {
        childId,
        planTemplateId: template.id,
        startDate: start,
        createdById: clinician.id,
        status: PlanStatus.ACTIVE,
      },
    });
    planId = plan.id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('returns an empty week list before any week is authored', async () => {
    const res = await http().get(`/v1/children/${childId}/care-plan`).set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.weeks).toEqual([]);
    expect(res.body.totalWeeks).toBe(0);
    expect(res.body.clinician).toEqual({ name: 'Dr. E. Okafor' });
  });

  it('lets the assigned clinician author weeks; others are refused', async () => {
    const body = week([
      activity('Narrate the morning', 1),
      activity('Visual timer', 2),
      activity('Turn-taking', 3),
    ]);
    for (const n of [1, 2, 3]) {
      const res = await http()
        .put(`/v1/plans/${planId}/weeks/${n}`)
        .set(auth(clinician.token))
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.totalActivitiesCount).toBe(3);
    }
    expect(
      (await http().put(`/v1/plans/${planId}/weeks/1`).set(auth(admin.token)).send(body)).status,
    ).toBe(200);
    for (const who of [parent, strangerClinician]) {
      const res = await http().put(`/v1/plans/${planId}/weeks/1`).set(auth(who.token)).send(body);
      expect(res.status).toBe(403);
    }
    expect(
      (await http().put(`/v1/plans/${planId}/weeks/13`).set(auth(clinician.token)).send(body))
        .status,
    ).toBe(400);
  });

  it('validates the week body', async () => {
    const bad = week([{ ...activity('X', 9) }]);
    expect(
      (await http().put(`/v1/plans/${planId}/weeks/1`).set(auth(clinician.token)).send(bad)).status,
    ).toBe(400);
    const noSteps = week([{ ...activity('X', 1), steps: [] }]);
    expect(
      (await http().put(`/v1/plans/${planId}/weeks/1`).set(auth(clinician.token)).send(noSteps))
        .status,
    ).toBe(400);
  });

  it('shows the parent the care plan with week statuses and the current day', async () => {
    const res = await http().get(`/v1/children/${childId}/care-plan`).set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.currentWeek).toBe(2);
    expect(res.body.currentDayOfWeek).toBe(2);
    expect(res.body.totalWeeks).toBe(3);
    expect(res.body.weeks.map((w: { status: string }) => w.status)).toEqual([
      'completed',
      'current',
      'upcoming',
    ]);
    expect(res.body.weeks[1].activities[0]).toMatchObject({
      title: 'Narrate the morning',
      dayOfWeek: 1,
      isCompleted: false,
      weekNumber: 2,
      steps: [{ title: 'Model' }],
      equipment: ['Visual timer'],
    });
    expect(res.body.weeks[1].goals[0].status).toBe('in_progress');
    expect(res.body.weeks[2].goals[0].status).toBe('upcoming');
  });

  it('scopes reads: other parent and unassigned clinician are forbidden; assigned clinician and admin can read', async () => {
    const url = `/v1/children/${childId}/care-plan`;
    expect((await http().get(url).set(auth(otherParent.token))).status).toBe(403);
    expect((await http().get(url).set(auth(strangerClinician.token))).status).toBe(403);
    expect((await http().get(url).set(auth(clinician.token))).status).toBe(200);
    expect((await http().get(url).set(auth(admin.token))).status).toBe(200);
  });

  describe('activity completion', () => {
    let activityId: string;
    const completion = () => `/v1/children/${childId}/activities/${activityId}/completion`;

    beforeAll(async () => {
      const res = await http().get(`/v1/children/${childId}/care-plan`).set(auth(parent.token));
      activityId = res.body.weeks[1].activities[0].id;
    });

    it('marks done (201), is idempotent (200) and updates progress', async () => {
      const first = await http()
        .post(completion())
        .set(auth(parent.token))
        .send({ note: 'Went well' });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ isCompleted: true, completionNote: 'Went well' });

      const again = await http().post(completion()).set(auth(parent.token)).send({});
      expect(again.status).toBe(200);
      expect(await ctx.prisma.activityCompletion.count({ where: { childId } })).toBe(1);

      const plan = await http().get(`/v1/children/${childId}/care-plan`).set(auth(parent.token));
      expect(plan.body.weeks[1]).toMatchObject({
        completedActivitiesCount: 1,
        totalActivitiesCount: 3,
        progressPercentage: 33,
      });
    });

    it('keeps the completion when the clinician edits the week in place', async () => {
      const body = week([activity('Narrate the morning (edited)', 1), activity('Visual timer', 2)]);
      const res = await http()
        .put(`/v1/plans/${planId}/weeks/2`)
        .set(auth(clinician.token))
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.totalActivitiesCount).toBe(2);
      expect(res.body.completedActivitiesCount).toBe(1);
      expect(
        await ctx.prisma.planActivity.count({ where: { week: { planId, weekNumber: 2 } } }),
      ).toBe(2);
    });

    it('refuses writes by clinician, admin, another parent; 404 for an unknown or foreign activity', async () => {
      for (const who of [clinician, admin, otherParent]) {
        expect((await http().post(completion()).set(auth(who.token)).send({})).status).toBe(403);
      }
      const unknown = `/v1/children/${childId}/activities/11111111-1111-1111-1111-111111111111/completion`;
      expect((await http().post(unknown).set(auth(parent.token)).send({})).status).toBe(404);
    });

    it('resets (204) idempotently', async () => {
      expect((await http().delete(completion()).set(auth(parent.token))).status).toBe(204);
      expect((await http().delete(completion()).set(auth(parent.token))).status).toBe(204);
      expect(await ctx.prisma.activityCompletion.count({ where: { childId } })).toBe(0);
      expect((await http().delete(completion()).set(auth(clinician.token))).status).toBe(403);
    });
  });

  it('returns 404 PLAN_NOT_FOUND once the plan is completed', async () => {
    await ctx.prisma.plan.update({ where: { id: planId }, data: { status: PlanStatus.COMPLETED } });
    const res = await http().get(`/v1/children/${childId}/care-plan`).set(auth(parent.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PLAN_NOT_FOUND');
    expect(
      (
        await http()
          .put(`/v1/plans/${planId}/weeks/1`)
          .set(auth(clinician.token))
          .send(week([activity('x', 1)]))
      ).status,
    ).toBe(409);
  });
});


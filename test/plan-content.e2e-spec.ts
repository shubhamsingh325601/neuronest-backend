import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Plan 0016: copy-on-assign plan content. Assigning snapshots the template's sections
 * and days into plan-owned rows; template edits/clones never touch an assigned plan;
 * the assigned clinician (or admin) can tailor the plan while it is ACTIVE.
 */
describe('Plan content model: snapshot, template editing, clinician edits (e2e)', () => {
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
  const as = (token: string) => (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  let admin: { id: string; token: string };
  let parent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let outsider: { id: string; token: string };
  let childId: string;
  let templateId: string;
  let planId: string;

  const content = {
    sections: [{ title: 'Morning' }, { title: 'Evening' }],
    days: [
      { dayNumber: 1, title: 'Day 1', instructions: 'A', sectionPosition: 1 },
      { dayNumber: 2, title: 'Day 2', instructions: 'B', sectionPosition: 2 },
      { dayNumber: 3, title: 'Day 3', instructions: 'C' },
    ],
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [admin, parent, clinician, outsider] = await Promise.all([
      createLoggedInUser('pc-admin@example.com', Role.ADMIN),
      createLoggedInUser('pc-parent@example.com', Role.PARENT),
      createLoggedInUser('pc-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('pc-outsider@example.com', Role.CLINICIAN),
    ]);
    const child = await as(parent.token)(
      http().post('/v1/children').send({ name: 'Sam', dateOfBirth: '2019-05-14' }),
    );
    childId = child.body.id as string;
    await as(admin.token)(
      http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: clinician.id }),
    );

    const created = await as(admin.token)(
      http()
        .post('/v1/plan-templates')
        .send({ title: 'Content template', ...content }),
    );
    expect(created.status).toBe(201);
    expect(created.body.sections).toHaveLength(2);
    templateId = created.body.id as string;
    await as(admin.token)(http().post(`/v1/plan-templates/${templateId}/publish`));

    const assigned = await as(clinician.token)(
      http()
        .post(`/v1/children/${childId}/plans`)
        .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
    );
    expect(assigned.status).toBe(201);
    planId = assigned.body.id as string;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('assign snapshots sections and days into the plan', async () => {
    const res = await as(parent.token)(http().get(`/v1/plans/${planId}`));
    expect(res.status).toBe(200);
    expect(res.body.days.map((d: { dayNumber: number }) => d.dayNumber)).toEqual([1, 2, 3]);
    expect(res.body.sections.map((s: { title: string }) => s.title)).toEqual([
      'Morning',
      'Evening',
    ]);
    expect(res.body.days[0].sectionId).toBe(res.body.sections[0].id);
    expect(res.body.days[2].sectionId).toBeNull();
  });

  it('a published template is immutable; clone gives an editable DRAFT that never affects the plan', async () => {
    const blocked = await as(admin.token)(
      http()
        .put(`/v1/plan-templates/${templateId}/content`)
        .send({ days: content.days.slice(0, 1) }),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PLAN_TEMPLATE_NOT_DRAFT');

    const clone = await as(admin.token)(http().post(`/v1/plan-templates/${templateId}/clone`));
    expect(clone.status).toBe(201);
    expect(clone.body.status).toBe('DRAFT');
    expect(clone.body.days).toHaveLength(3);
    expect(clone.body.sections).toHaveLength(2);

    const edited = await as(admin.token)(
      http()
        .put(`/v1/plan-templates/${clone.body.id}/content`)
        .send({ days: [{ dayNumber: 1, title: 'Only day', instructions: 'Z' }] }),
    );
    expect(edited.status).toBe(200);
    expect(edited.body.days).toHaveLength(1);
    expect(edited.body.sections).toHaveLength(0);

    const plan = await as(parent.token)(http().get(`/v1/plans/${planId}`));
    expect(plan.body.days).toHaveLength(3);
  });

  it('assigned clinician upserts a day, including beyond the template range', async () => {
    const edit = await as(clinician.token)(
      http().put(`/v1/plans/${planId}/days/2`).send({ title: 'Tailored', instructions: 'Custom' }),
    );
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ dayNumber: 2, title: 'Tailored' });

    const extra = await as(clinician.token)(
      http().put(`/v1/plans/${planId}/days/10`).send({ title: 'Bonus', instructions: 'More' }),
    );
    expect(extra.status).toBe(200);

    const tooFar = await as(clinician.token)(
      http().put(`/v1/plans/${planId}/days/400`).send({ title: 'x', instructions: 'y' }),
    );
    expect(tooFar.status).toBe(400);
  });

  it('parent and unassigned clinician cannot edit', async () => {
    const body = { title: 'x', instructions: 'y' };
    const asParent = await as(parent.token)(http().put(`/v1/plans/${planId}/days/1`).send(body));
    expect(asParent.status).toBe(403);
    const asOutsider = await as(outsider.token)(
      http().put(`/v1/plans/${planId}/days/1`).send(body),
    );
    expect(asOutsider.status).toBe(403);
  });

  it('replaces sections keeping ids, and deletes a day idempotently', async () => {
    const before = await as(clinician.token)(http().get(`/v1/plans/${planId}`));
    const [morning] = before.body.sections as { id: string }[];
    const res = await as(clinician.token)(
      http()
        .put(`/v1/plans/${planId}/sections`)
        .send({ sections: [{ title: 'New first' }, { id: morning.id, title: 'Morning renamed' }] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.map((s: { title: string }) => s.title)).toEqual([
      'New first',
      'Morning renamed',
    ]);
    expect(res.body[1].id).toBe(morning.id);

    const first = await as(clinician.token)(http().delete(`/v1/plans/${planId}/days/10`));
    const second = await as(clinician.token)(http().delete(`/v1/plans/${planId}/days/10`));
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it('today focus reads from the plan-owned days', async () => {
    const res = await as(parent.token)(http().get(`/v1/children/${childId}/plans/today`));
    expect(res.status).toBe(200);
  });

  it('edits are refused once the plan is archived', async () => {
    await as(clinician.token)(http().post(`/v1/plans/${planId}/archive`));
    const res = await as(clinician.token)(
      http().put(`/v1/plans/${planId}/days/1`).send({ title: 'x', instructions: 'y' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_NOT_ACTIVE');
  });
});

import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Plan domain: template authoring/publish, per-child assignment lifecycle, "today's
 * focus," and clinician notes — the assignment invariant (one ACTIVE plan per child),
 * the publish gate, and the same cross-parent/cross-clinician isolation shape as
 * `child-care-domain.e2e-spec.ts` (Phase 4) and `media-upload.e2e-spec.ts` (Phase 5),
 * applied through `Plan.childId`. All actors are created once in `beforeAll` and
 * reused across every `it`.
 */
describe('Plan domain: templates → assignment → today\'s focus → notes (e2e)', () => {
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
  let parentOwner: { id: string; token: string };
  let parentOther: { id: string; token: string };
  let clinicianAssigned: { id: string; token: string };
  let clinicianOther: { id: string; token: string };
  let childId: string;

  const templateDays = [
    { dayNumber: 1, title: 'Day 1', instructions: 'Say hello' },
    { dayNumber: 2, title: 'Day 2', instructions: 'Practice waving' },
    { dayNumber: 3, title: 'Day 3', instructions: 'Practice sharing' },
  ];

  const createPublishedTemplate = async (title: string) => {
    const created = await asToken(admin.token)(
      http().post('/v1/plan-templates').send({ title, days: templateDays }),
    );
    expect(created.status).toBe(201);
    const templateId = created.body.id as string;
    const published = await asToken(admin.token)(
      http().post(`/v1/plan-templates/${templateId}/publish`),
    );
    expect(published.status).toBe(200);
    return templateId;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [admin, parentOwner, parentOther, clinicianAssigned, clinicianOther] = await Promise.all([
      createLoggedInUser('plan-admin@example.com', Role.ADMIN),
      createLoggedInUser('plan-owner-parent@example.com', Role.PARENT),
      createLoggedInUser('plan-other-parent@example.com', Role.PARENT),
      createLoggedInUser('plan-assigned-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('plan-other-clinician@example.com', Role.CLINICIAN),
    ]);

    const child = await asToken(parentOwner.token)(
      http().post('/v1/children').send({ name: 'Alex', dateOfBirth: '2019-05-14' }),
    );
    childId = child.body.id as string;

    await asToken(admin.token)(
      http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: clinicianAssigned.id }),
    );
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('plan templates', () => {
    it('admin creates a DRAFT template with nested days', async () => {
      const res = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Week 1', days: templateDays }),
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'Week 1', status: 'DRAFT' });
      expect(res.body.days).toHaveLength(3);
    });

    it('rejects a non-contiguous days[] set', async () => {
      const res = await asToken(admin.token)(
        http()
          .post('/v1/plan-templates')
          .send({
            title: 'Bad template',
            days: [
              { dayNumber: 1, title: 'Day 1', instructions: 'x' },
              { dayNumber: 3, title: 'Day 3', instructions: 'y' },
            ],
          }),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('a clinician cannot create a template (role lacks the permission)', async () => {
      const res = await asToken(clinicianAssigned.token)(
        http().post('/v1/plan-templates').send({ title: 'Nope', days: templateDays }),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it("GET /v1/plan-templates as a clinician never returns a DRAFT row", async () => {
      const draft = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Still draft', days: templateDays }),
      );
      const list = await asToken(clinicianAssigned.token)(http().get('/v1/plan-templates'));
      expect(list.status).toBe(200);
      expect(list.body.data.some((t: { id: string }) => t.id === draft.body.id)).toBe(false);
      expect(list.body.data.every((t: { status: string }) => t.status === 'PUBLISHED')).toBe(true);
    });

    it('admin sees DRAFT rows in the list', async () => {
      const draft = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Admin visible draft', days: templateDays }),
      );
      const list = await asToken(admin.token)(http().get('/v1/plan-templates'));
      expect(list.status).toBe(200);
      expect(list.body.data.some((t: { id: string }) => t.id === draft.body.id)).toBe(true);
    });

    it('a clinician fetching a DRAFT template by id gets 404, not 403', async () => {
      const draft = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Hidden draft', days: templateDays }),
      );
      const res = await asToken(clinicianAssigned.token)(
        http().get(`/v1/plan-templates/${draft.body.id}`),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PLAN_TEMPLATE_NOT_FOUND');
    });

    it('publish is idempotent and a one-way gate', async () => {
      const created = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Publish me', days: templateDays }),
      );
      const templateId = created.body.id as string;

      const first = await asToken(admin.token)(
        http().post(`/v1/plan-templates/${templateId}/publish`),
      );
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('PUBLISHED');

      const second = await asToken(admin.token)(
        http().post(`/v1/plan-templates/${templateId}/publish`),
      );
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('PUBLISHED');

      const nowVisible = await asToken(clinicianAssigned.token)(
        http().get(`/v1/plan-templates/${templateId}`),
      );
      expect(nowVisible.status).toBe(200);
    });
  });

  describe('plan assignment + lifecycle', () => {
    it('assigning a DRAFT template is 409', async () => {
      const draft = await asToken(admin.token)(
        http().post('/v1/plan-templates').send({ title: 'Unpublished', days: templateDays }),
      );
      const res = await asToken(admin.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: draft.body.id, startDate: '2026-09-22' }),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PLAN_TEMPLATE_NOT_PUBLISHED');
    });

    it('a non-assigned clinician cannot assign a plan', async () => {
      const templateId = await createPublishedTemplate('Non-assigned attempt');
      const res = await asToken(clinicianOther.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('a parent cannot assign a plan (role lacks the permission)', async () => {
      const templateId = await createPublishedTemplate('Parent attempt');
      const res = await asToken(parentOwner.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('an assigned clinician assigns a published template; a second ACTIVE assignment is 409', async () => {
      const templateId = await createPublishedTemplate('Active program');
      const assigned = await asToken(clinicianAssigned.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
      );
      expect(assigned.status).toBe(201);
      expect(assigned.body).toMatchObject({ childId, planTemplateId: templateId, status: 'ACTIVE' });
      const planId = assigned.body.id as string;

      const secondTemplateId = await createPublishedTemplate('Second program');
      const conflict = await asToken(clinicianAssigned.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: secondTemplateId, startDate: '2026-09-22' }),
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('PLAN_ALREADY_ACTIVE');

      // Clean up so later tests in this suite can assign freely again.
      const archived = await asToken(clinicianAssigned.token)(
        http().post(`/v1/plans/${planId}/archive`),
      );
      expect(archived.status).toBe(200);
      expect(archived.body.status).toBe('ARCHIVED');
    });

    it('completing/archiving is idempotent, and cross-terminal-transition is 409', async () => {
      const templateId = await createPublishedTemplate('Lifecycle program');
      const assigned = await asToken(admin.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
      );
      const planId = assigned.body.id as string;

      const completedOnce = await asToken(admin.token)(
        http().post(`/v1/plans/${planId}/complete`),
      );
      expect(completedOnce.status).toBe(200);
      expect(completedOnce.body.status).toBe('COMPLETED');

      const completedTwice = await asToken(admin.token)(
        http().post(`/v1/plans/${planId}/complete`),
      );
      expect(completedTwice.status).toBe(200);
      expect(completedTwice.body.status).toBe('COMPLETED');

      const archiveAfterComplete = await asToken(admin.token)(
        http().post(`/v1/plans/${planId}/archive`),
      );
      expect(archiveAfterComplete.status).toBe(409);
      expect(archiveAfterComplete.body.code).toBe('PLAN_ALREADY_FINAL');
    });

    it('completing a non-existent plan is a 404', async () => {
      const res = await asToken(admin.token)(
        http().post('/v1/plans/11111111-1111-1111-1111-111111111111/complete'),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PLAN_NOT_FOUND');
    });
  });

  describe("today's focus", () => {
    it('a child with no active plan is 404', async () => {
      const child = await asToken(parentOther.token)(
        http().post('/v1/children').send({ name: 'Sam', dateOfBirth: '2020-01-01' }),
      );
      const res = await asToken(parentOther.token)(
        http().get(`/v1/children/${child.body.id}/plans/today`),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PLAN_NOT_FOUND');
    });

    it("the owning parent reads today's focus for an active plan started today", async () => {
      const templateId = await createPublishedTemplate('Focus program');
      const today = new Date().toISOString().slice(0, 10);
      const assigned = await asToken(admin.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: today }),
      );
      expect(assigned.status).toBe(201);

      const res = await asToken(parentOwner.token)(
        http().get(`/v1/children/${childId}/plans/today`),
      );
      expect(res.status).toBe(200);
      expect(res.body.plan.status).toBe('ACTIVE');
      expect(res.body.day).toMatchObject({ dayNumber: 1, title: 'Day 1' });

      // Clean up so later tests can assign freely again.
      await asToken(admin.token)(http().post(`/v1/plans/${assigned.body.id}/archive`));
    });

    it('a non-owning parent cannot read today\'s focus', async () => {
      const res = await asToken(parentOther.token)(
        http().get(`/v1/children/${childId}/plans/today`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('a non-assigned clinician cannot read today\'s focus', async () => {
      const res = await asToken(clinicianOther.token)(
        http().get(`/v1/children/${childId}/plans/today`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('plan notes', () => {
    let notesPlanId: string;

    beforeAll(async () => {
      const templateId = await createPublishedTemplate('Notes program');
      const assigned = await asToken(admin.token)(
        http()
          .post(`/v1/children/${childId}/plans`)
          .send({ planTemplateId: templateId, startDate: '2026-09-22' }),
      );
      notesPlanId = assigned.body.id as string;
    });

    it('an assigned clinician can create and list notes', async () => {
      const created = await asToken(clinicianAssigned.token)(
        http().post(`/v1/plans/${notesPlanId}/notes`).send({ note: 'First observation' }),
      );
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ planId: notesPlanId, note: 'First observation' });

      const list = await asToken(clinicianAssigned.token)(
        http().get(`/v1/plans/${notesPlanId}/notes`),
      );
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
    });

    it('notes list is oldest-first', async () => {
      await asToken(clinicianAssigned.token)(
        http().post(`/v1/plans/${notesPlanId}/notes`).send({ note: 'Second observation' }),
      );
      const list = await asToken(clinicianAssigned.token)(
        http().get(`/v1/plans/${notesPlanId}/notes`),
      );
      const createdAts = (list.body.data as Array<{ createdAt: string }>).map((n) =>
        new Date(n.createdAt).getTime(),
      );
      const sorted = [...createdAts].sort((a, b) => a - b);
      expect(createdAts).toEqual(sorted);
    });

    it('a non-assigned clinician cannot create or read notes', async () => {
      const createRes = await asToken(clinicianOther.token)(
        http().post(`/v1/plans/${notesPlanId}/notes`).send({ note: 'Intruding' }),
      );
      expect(createRes.status).toBe(403);
      expect(createRes.body.code).toBe('FORBIDDEN');

      const listRes = await asToken(clinicianOther.token)(
        http().get(`/v1/plans/${notesPlanId}/notes`),
      );
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe('FORBIDDEN');
    });

    it('a parent cannot read plan notes (role lacks the permission)', async () => {
      const res = await asToken(parentOwner.token)(
        http().get(`/v1/plans/${notesPlanId}/notes`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('admin can create and read notes unconditionally', async () => {
      const created = await asToken(admin.token)(
        http().post(`/v1/plans/${notesPlanId}/notes`).send({ note: 'Admin note' }),
      );
      expect(created.status).toBe(201);

      const list = await asToken(admin.token)(http().get(`/v1/plans/${notesPlanId}/notes`));
      expect(list.status).toBe(200);
    });
  });
});

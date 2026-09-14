import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Clinician application (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('creates a PENDING lead with no auth', async () => {
    const res = await http().post('/v1/clinician-applications').send({
      name: 'Dr. Sam Okafor',
      email: 'sam@clinic.example',
      context: 'Paediatric OT interested in the pilot.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING' });
    expect(res.body.id).toEqual(expect.any(String));

    const row = await ctx.prisma.clinicianApplication.findUnique({ where: { id: res.body.id } });
    expect(row?.email).toBe('sam@clinic.example');
  });

  it('rejects an invalid payload', async () => {
    const res = await http()
      .post('/v1/clinician-applications')
      .send({ name: '', email: 'not-an-email', context: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/validation-error',
      title: 'Validation Error',
      status: 400,
    });
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

describe('Clinician application admin review (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  const adminEmail = 'reviewer@neuronest.test';
  const adminPassword = 'admin-strong-passphrase';
  let adminToken: string;

  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
  const submitApplication = (over: Record<string, string> = {}) =>
    http()
      .post('/v1/clinician-applications')
      .send({
        name: 'Dr. Sam Okafor',
        email: 'sam@clinic.example',
        context: 'Paediatric OT interested in the pilot.',
        ...over,
      });

  beforeAll(async () => {
    ctx = await createTestApp();
    const passwords = ctx.app.get(PasswordService);
    await ctx.prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await passwords.hash(adminPassword),
        name: 'Reviewer',
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = login.body.accessToken as string;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('requires a permission — no token is 401', async () => {
    const res = await http().get('/v1/clinician-applications');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin caller with 403', async () => {
    const parentEmail = 'parent-reviewer@example.com';
    const parentPassword = 'parent-strong-passphrase';
    await http().post('/v1/auth/signup').send({ email: parentEmail, password: parentPassword, name: 'P' });
    const code = ctx.mail.lastCodeFor(parentEmail)!;
    await http().post('/v1/auth/verify-email').send({ email: parentEmail, code });
    const login = await http().post('/v1/auth/login').send({ email: parentEmail, password: parentPassword });

    const res = await http()
      .get('/v1/clinician-applications')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('cursor-paginates and filters by status', async () => {
    const a = await submitApplication({ email: 'a@clinic.example' });
    const b = await submitApplication({ email: 'b@clinic.example' });

    const page1 = await asAdmin(http().get('/v1/clinician-applications').query({ limit: 1 }));
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await asAdmin(
      http().get('/v1/clinician-applications').query({ limit: 1, cursor: page1.body.nextCursor }),
    );
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    expect([a.body.id, b.body.id].sort()).toEqual(
      [page1.body.data[0].id, page2.body.data[0].id].sort(),
    );

    const pending = await asAdmin(
      http().get('/v1/clinician-applications').query({ status: 'PENDING' }),
    );
    expect(pending.body.data.length).toBeGreaterThanOrEqual(2);
    const approved = await asAdmin(
      http().get('/v1/clinician-applications').query({ status: 'APPROVED' }),
    );
    expect(approved.body.data).toEqual([]);

    const bad = await asAdmin(
      http().get('/v1/clinician-applications').query({ cursor: 'not-a-cursor' }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CURSOR');
  });

  it('fetches one by id, 404s an unknown id, 400s a non-uuid', async () => {
    const created = await submitApplication({ email: 'one@clinic.example' });

    const found = await asAdmin(http().get(`/v1/clinician-applications/${created.body.id}`));
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ id: created.body.id, status: 'PENDING', reviewNote: null });

    const missing = await asAdmin(
      http().get('/v1/clinician-applications/11111111-1111-1111-1111-111111111111'),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('APPLICATION_NOT_FOUND');

    const notUuid = await asAdmin(http().get('/v1/clinician-applications/nope'));
    expect(notUuid.status).toBe(400);
  });

  it('approve → invited clinician → account setup → login', async () => {
    const created = await submitApplication({ email: 'newclin@clinic.example' });

    const approved = await asAdmin(
      http().post(`/v1/clinician-applications/${created.body.id}/approve`),
    );
    expect(approved.status).toBe(200);
    expect(approved.body.application.status).toBe('APPROVED');
    expect(approved.body.clinicianUserId).toEqual(expect.any(String));

    const user = await ctx.prisma.user.findUnique({ where: { email: 'newclin@clinic.example' } });
    expect(user).toMatchObject({ role: 'CLINICIAN', status: 'INVITED', passwordHash: null });

    // Cannot log in yet.
    const early = await http()
      .post('/v1/auth/login')
      .send({ email: 'newclin@clinic.example', password: 'chosen-strong-passphrase' });
    expect(early.status).toBe(401);

    const setupUrl = ctx.mail.lastSetupUrlFor('newclin@clinic.example')!;
    const token = new URL(setupUrl).searchParams.get('token')!;

    const badToken = await http()
      .post('/v1/auth/complete-account-setup')
      .send({ token: 'x'.repeat(43), password: 'chosen-strong-passphrase' });
    expect(badToken.status).toBe(400);
    expect(badToken.body.code).toBe('INVALID_SETUP_TOKEN');
    expect(badToken.headers['content-type']).toContain('application/problem+json');

    const setup = await http()
      .post('/v1/auth/complete-account-setup')
      .send({ token, password: 'chosen-strong-passphrase' });
    expect(setup.status).toBe(200);
    expect(setup.body).toEqual({ complete: true });

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: 'newclin@clinic.example', password: 'chosen-strong-passphrase' });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toEqual(expect.any(String));

    // Re-approving is an idempotent no-op — no second setup email.
    ctx.mail.clear();
    const again = await asAdmin(
      http().post(`/v1/clinician-applications/${created.body.id}/approve`),
    );
    expect(again.status).toBe(200);
    expect(again.body.application.status).toBe('APPROVED');
    expect(ctx.mail.lastSetupUrlFor('newclin@clinic.example')).toBeUndefined();

    // Rejecting an approved application is a real conflict.
    const flip = await asAdmin(
      http().post(`/v1/clinician-applications/${created.body.id}/reject`).send({}),
    );
    expect(flip.status).toBe(409);
    expect(flip.body.code).toBe('APPLICATION_DECISION_FINAL');
  });

  it('rejects with a reason, is idempotent, and blocks a later approve', async () => {
    const created = await submitApplication({ email: 'reject-me@clinic.example' });

    const rejected = await asAdmin(
      http()
        .post(`/v1/clinician-applications/${created.body.id}/reject`)
        .send({ reason: '  Outside current specialties.  ' }),
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.application).toMatchObject({
      status: 'REJECTED',
      reviewNote: 'Outside current specialties.',
    });

    const again = await asAdmin(
      http()
        .post(`/v1/clinician-applications/${created.body.id}/reject`)
        .send({ reason: 'a different note' }),
    );
    expect(again.status).toBe(200);
    expect(again.body.application.reviewNote).toBe('Outside current specialties.');

    const approve = await asAdmin(
      http().post(`/v1/clinician-applications/${created.body.id}/approve`),
    );
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe('APPLICATION_DECISION_FINAL');
  });

  it('409s an approve when a user already owns the application email', async () => {
    const created = await submitApplication({ email: adminEmail });

    const res = await asAdmin(
      http().post(`/v1/clinician-applications/${created.body.id}/approve`),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    const row = await ctx.prisma.clinicianApplication.findUnique({ where: { id: created.body.id } });
    expect(row?.status).toBe('PENDING');
  });
});

import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Admin-created clinician lifecycle (plan 0010): create → invite → setup → login. */
describe('Clinician lifecycle (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const chosen = 'chosen-strong-passphrase';
  const missingId = '11111111-1111-1111-1111-111111111111';

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
    const login = await loginAs(email, password);
    return { id: user.id, token: login.body.accessToken as string };
  };
  const as = (token: string) => (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const tokenFromMail = (to: string) =>
    new URL(ctx.mail.lastSetupUrlFor(to)!).searchParams.get('token')!;
  // The /v1/auth surface is limited to 5 requests/min per IP; give each auth call its own
  // client address (the app trusts one proxy hop in this suite).
  let nextClient = 1;
  const fromNewClient = (req: request.Test) => req.set('X-Forwarded-For', `10.1.0.${nextClient++}`);
  const completeSetup = (token: string, pw = chosen) =>
    fromNewClient(http().post('/v1/auth/complete-account-setup').send({ token, password: pw }));
  const loginAs = (email: string, pw: string) =>
    fromNewClient(http().post('/v1/auth/login').send({ email, password: pw }));

  let admin: { id: string; token: string };
  let parent: { id: string; token: string };
  let clinician: { id: string; token: string };

  const createClinician = (body: Record<string, unknown>) =>
    as(admin.token)(http().post('/v1/clinicians').send(body));

  beforeAll(async () => {
    ctx = await createTestApp({ trustProxyHops: 1 });
    admin = await createLoggedInUser('lifecycle-admin@example.com', Role.ADMIN);
    parent = await createLoggedInUser('lifecycle-parent@example.com', Role.PARENT);
    clinician = await createLoggedInUser('lifecycle-clinician@example.com', Role.CLINICIAN);
  });
  beforeEach(() => {
    ctx.mail.clear();
    ctx.mail.failSends = false;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('create → mail captured → complete setup → login', async () => {
    const res = await createClinician({
      name: 'Dr. Sam Okafor',
      email: 'Sam@Clinic.Example',
      profile: { specialisation: 'Paediatric OT', licenseNumber: 'L-1' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Dr. Sam Okafor',
      email: 'sam@clinic.example',
      status: 'INVITED',
      activatedAt: null,
      lastLoginAt: null,
      assignedChildIds: [],
      profile: { specialisation: 'Paediatric OT', licenseNumber: 'L-1', phone: null },
    });
    expect(res.body.invitationSentAt).toEqual(expect.any(String));
    const hours =
      (Date.parse(res.body.invitationExpiresAt) - Date.parse(res.body.invitationSentAt)) / 3_600_000;
    expect(Math.round(hours)).toBe(72);

    const user = await ctx.prisma.user.findUnique({ where: { email: 'sam@clinic.example' } });
    expect(user).toMatchObject({ role: 'CLINICIAN', status: 'INVITED', passwordHash: null });

    // Cannot log in before setup.
    const early = await loginAs('sam@clinic.example', chosen);
    expect(early.status).toBe(401);

    const bad = await completeSetup('x'.repeat(43));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SETUP_TOKEN');

    const setup = await completeSetup(tokenFromMail('sam@clinic.example'));
    expect(setup.status).toBe(200);

    const login = await loginAs('sam@clinic.example', chosen);
    expect(login.status).toBe(200);

    const detail = await as(admin.token)(http().get(`/v1/clinicians/${res.body.id}`));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ status: 'ACTIVE', activatedAt: expect.any(String) });
  });

  it('rejects a duplicate email with 409 and an invalid payload with 400', async () => {
    const dup = await createClinician({ name: 'Dup', email: 'lifecycle-parent@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    const invalid = await createClinician({ name: '', email: 'nope', extra: 1 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('resend invalidates the old link, issues a new one, and creates no second user', async () => {
    const created = await createClinician({ name: 'Resend Me', email: 'resend@clinic.example' });
    const oldToken = tokenFromMail('resend@clinic.example');

    const resend = await as(admin.token)(
      http().post(`/v1/clinicians/${created.body.id}/resend-invitation`),
    );
    expect(resend.status).toBe(202);
    expect(resend.text).toBe('');
    const newToken = tokenFromMail('resend@clinic.example');
    expect(newToken).not.toBe(oldToken);

    expect((await completeSetup(oldToken)).status).toBe(400);
    expect((await completeSetup(newToken)).status).toBe(200);

    expect(await ctx.prisma.user.count({ where: { email: 'resend@clinic.example' } })).toBe(1);

    // Now ACTIVE → resend is a conflict.
    const again = await as(admin.token)(
      http().post(`/v1/clinicians/${created.body.id}/resend-invitation`),
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CLINICIAN_NOT_INVITED');
  });

  it('PATCH changes the email while INVITED (re-inviting the new address) and locks it after activation', async () => {
    const created = await createClinician({ name: 'Mover', email: 'old-addr@clinic.example' });
    const oldToken = tokenFromMail('old-addr@clinic.example');

    const patch = await as(admin.token)(
      http()
        .patch(`/v1/clinicians/${created.body.id}`)
        .send({ email: 'new-addr@clinic.example', name: 'Mover 2', profile: { bio: 'Hello' } }),
    );
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({
      email: 'new-addr@clinic.example',
      name: 'Mover 2',
      profile: { bio: 'Hello' },
    });

    // Old link died; the new address got its own.
    expect((await completeSetup(oldToken)).status).toBe(400);
    expect((await completeSetup(tokenFromMail('new-addr@clinic.example'))).status).toBe(200);

    const locked = await as(admin.token)(
      http().patch(`/v1/clinicians/${created.body.id}`).send({ email: 'third@clinic.example' }),
    );
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('CLINICIAN_EMAIL_LOCKED');

    // Non-email edits still work after activation.
    const rename = await as(admin.token)(
      http().patch(`/v1/clinicians/${created.body.id}`).send({ name: 'Mover 3' }),
    );
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('Mover 3');
  });

  it('PATCH to an email that is taken is a 409', async () => {
    const created = await createClinician({ name: 'Clash', email: 'clash@clinic.example' });
    const res = await as(admin.token)(
      http()
        .patch(`/v1/clinicians/${created.body.id}`)
        .send({ email: 'lifecycle-parent@example.com' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('a failing email provider never rolls back creation; the admin can resend', async () => {
    ctx.mail.failSends = true;
    const res = await createClinician({ name: 'Unlucky', email: 'unlucky@clinic.example' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('INVITED');
    expect(ctx.mail.lastSetupUrlFor('unlucky@clinic.example')).toBeUndefined();
    expect(await ctx.prisma.user.count({ where: { email: 'unlucky@clinic.example' } })).toBe(1);

    ctx.mail.failSends = false;
    const resend = await as(admin.token)(http().post(`/v1/clinicians/${res.body.id}/resend-invitation`));
    expect(resend.status).toBe(202);
    expect(ctx.mail.lastSetupUrlFor('unlucky@clinic.example')).toBeDefined();
  });

  it('suspend → old link dead; reactivate restores INVITED; resend → setup → login', async () => {
    const created = await createClinician({ name: 'Paused', email: 'paused@clinic.example' });
    const oldToken = tokenFromMail('paused@clinic.example');

    const suspend = await as(admin.token)(http().post(`/v1/users/${created.body.id}/suspend`));
    expect(suspend.status).toBe(200);
    expect((await completeSetup(oldToken)).status).toBe(400);

    const reactivate = await as(admin.token)(
      http().post(`/v1/users/${created.body.id}/reactivate`),
    );
    expect(reactivate.body).toMatchObject({ status: 'INVITED' });

    const resend = await as(admin.token)(
      http().post(`/v1/clinicians/${created.body.id}/resend-invitation`),
    );
    expect(resend.status).toBe(202);
    expect((await completeSetup(tokenFromMail('paused@clinic.example'))).status).toBe(200);

    const login = await loginAs('paused@clinic.example', chosen);
    expect(login.status).toBe(200);
  });

  it('GET /clinicians supports ?status= and ?q= and carries invitation fields', async () => {
    await createClinician({ name: 'Zed Findable', email: 'zed-findable@clinic.example' });

    const byQ = await as(admin.token)(http().get('/v1/clinicians?q=ZED-FIND'));
    expect(byQ.status).toBe(200);
    expect(byQ.body.data).toHaveLength(1);
    expect(byQ.body.data[0]).toMatchObject({
      email: 'zed-findable@clinic.example',
      status: 'INVITED',
      invitationSentAt: expect.any(String),
      invitationExpiresAt: expect.any(String),
    });

    const invited = await as(admin.token)(http().get('/v1/clinicians?status=INVITED'));
    expect(invited.body.data.every((c: { status: string }) => c.status === 'INVITED')).toBe(true);
    expect(invited.body.data.length).toBeGreaterThan(0);

    const bad = await as(admin.token)(http().get('/v1/clinicians?status=NOPE'));
    expect(bad.status).toBe(400);
  });

  it('unknown or non-clinician ids are 404 CLINICIAN_NOT_FOUND on every id route', async () => {
    for (const id of [missingId, parent.id]) {
      const get = await as(admin.token)(http().get(`/v1/clinicians/${id}`));
      expect(get.status).toBe(404);
      expect(get.body.code).toBe('CLINICIAN_NOT_FOUND');
      const patch = await as(admin.token)(http().patch(`/v1/clinicians/${id}`).send({ name: 'x' }));
      expect(patch.status).toBe(404);
      const resend = await as(admin.token)(http().post(`/v1/clinicians/${id}/resend-invitation`));
      expect(resend.status).toBe(404);
    }
  });

  it('non-admins get 403 on every clinician route', async () => {
    for (const actor of [parent, clinician]) {
      // Built lazily: a supertest request binds its server when constructed.
      const calls = [
        () => http().post('/v1/clinicians').send({ name: 'x', email: 'x@y.example' }),
        () => http().get('/v1/clinicians'),
        () => http().get(`/v1/clinicians/${missingId}`),
        () => http().patch(`/v1/clinicians/${missingId}`).send({ name: 'x' }),
        () => http().post(`/v1/clinicians/${missingId}/resend-invitation`),
      ];
      for (const call of calls) {
        const res = await as(actor.token)(call());
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    }
    const anon = await http().post('/v1/clinicians').send({ name: 'x', email: 'x@y.example' });
    expect(anon.status).toBe(401);
  });

  it('the removed clinician-application routes are gone (404)', async () => {
    const id = missingId;
    const calls = [
      () => http().post('/v1/clinician-applications').send({ name: 'x', email: 'x@y.example', context: 'c' }),
      () => http().get('/v1/clinician-applications'),
      () => http().get(`/v1/clinician-applications/${id}`),
      () => http().post(`/v1/clinician-applications/${id}/approve`),
      () => http().post(`/v1/clinician-applications/${id}/reject`).send({ note: 'n' }),
    ];
    for (const call of calls) {
      const res = await as(admin.token)(call());
      expect(res.status).toBe(404);
    }
  });
});

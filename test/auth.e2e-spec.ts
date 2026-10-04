import request from 'supertest';
import { UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Auth flow (e2e): signup -> verify -> login -> refresh -> logout', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  const email = 'parent@example.com';
  const password = 'a-strong-passphrase';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('signs up and emails a verification code', async () => {
    const res = await http().post('/v1/auth/signup').send({ email, password, name: 'Jordan' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email });
    expect(ctx.mail.lastCodeFor(email)).toMatch(/^\d{6}$/);
  });

  it('blocks login until the email is verified', async () => {
    const res = await http().post('/v1/auth/login').send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    // RFC 9457 envelope — code/status unchanged, repackaged.
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/email-not-verified',
      title: 'Email Not Verified',
      status: 403,
      instance: '/v1/auth/login',
    });
  });

  it('verifies the email with the code', async () => {
    const code = ctx.mail.lastCodeFor(email)!;
    const res = await http().post('/v1/auth/verify-email').send({ email, code });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
  });

  let accessToken: string;
  let refreshToken: string;

  it('logs in and returns a session', async () => {
    const res = await http().post('/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('serves the profile from the access token', async () => {
    const res = await http().get('/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email, role: 'PARENT', status: 'ACTIVE' });
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.lastLoginAt).not.toBeNull();
  });

  let rotatedRefresh: string;

  it('rotates the refresh token', async () => {
    const res = await http().post('/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toEqual(refreshToken);
    rotatedRefresh = res.body.refreshToken;
  });

  it('rejects reuse of the old refresh token and kills the family', async () => {
    const reuse = await http().post('/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);

    // The rotated token was also revoked by the reuse-detection sweep.
    const rotated = await http().post('/v1/auth/refresh').send({ refreshToken: rotatedRefresh });
    expect(rotated.status).toBe(401);
  });

  it('logs in again and logs out', async () => {
    const login = await http().post('/v1/auth/login').send({ email, password });
    const token = login.body.refreshToken as string;

    const logout = await http().post('/v1/auth/logout').send({ refreshToken: token });
    expect(logout.status).toBe(204);

    const afterLogout = await http().post('/v1/auth/refresh').send({ refreshToken: token });
    expect(afterLogout.status).toBe(401);
  });
});

describe('Change password (B4, e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const email = 'change-password@example.com';
  const oldPassword = 'the-old-passphrase';
  const newPassword = 'the-new-passphrase';

  beforeAll(async () => {
    ctx = await createTestApp();
    const passwords = ctx.app.get(PasswordService);
    await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(oldPassword),
        name: 'Changer',
        role: 'PARENT',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('401s on a wrong current password', async () => {
    const login = await http().post('/v1/auth/login').send({ email, password: oldPassword });
    const accessToken = login.body.accessToken as string;

    const res = await http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'not-it', newPassword });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires authentication', async () => {
    const res = await http()
      .post('/v1/auth/change-password')
      .send({ currentPassword: oldPassword, newPassword });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('changes the password and kills every other session, including the current one', async () => {
    const login = await http().post('/v1/auth/login').send({ email, password: oldPassword });
    const accessToken = login.body.accessToken as string;
    const refreshToken = login.body.refreshToken as string;

    const change = await http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: oldPassword, newPassword });
    expect(change.status).toBe(200);
    expect(change.body).toMatchObject({ status: 'PASSWORD_CHANGED' });

    // The refresh token from before the change is revoked.
    const refresh = await http().post('/v1/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
    expect(refresh.body.code).toBe('INVALID_REFRESH_TOKEN');

    // The old password no longer works.
    const oldLogin = await http().post('/v1/auth/login').send({ email, password: oldPassword });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body.code).toBe('INVALID_CREDENTIALS');

    // The new password does.
    const newLogin = await http().post('/v1/auth/login').send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.accessToken).toEqual(expect.any(String));
  });

  it('is covered by the shared /v1/auth/* rate limit (5 req/60s)', async () => {
    // Earlier tests in this describe already spent part of this handler's 5 req/60s
    // budget (the guard is per IP + handler, on the same app instance for the whole
    // describe) — keep firing until the limit trips rather than pinning an exact count.
    const login = await http().post('/v1/auth/login').send({ email, password: newPassword });
    const accessToken = login.body.accessToken as string;
    const asAuthed = () =>
      http().post('/v1/auth/change-password').set('Authorization', `Bearer ${accessToken}`);

    let limitedStatus: number | undefined;
    let limitedCode: string | undefined;
    for (let i = 0; i < 10 && limitedStatus === undefined; i += 1) {
      const res = await asAuthed().send({ currentPassword: 'wrong-on-purpose', newPassword });
      if (res.status === 429) {
        limitedStatus = res.status;
        limitedCode = res.body.code as string;
      }
    }
    expect(limitedStatus).toBe(429);
    expect(limitedCode).toBe('RATE_LIMITED');
  });
});

describe('Auth correctness under contention (Phase 9 Batch 1, e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('B-1: a second signup for an unverified email replaces credentials — only the second password works', async () => {
    const email = 'prehijack@example.com';
    const attacker = await http()
      .post('/v1/auth/signup')
      .send({ email, password: 'attacker-passphrase-1', name: 'Attacker' });
    expect(attacker.status).toBe(201);
    const attackerSession = ctx.mail.lastCodeFor(email)!;

    const owner = await http()
      .post('/v1/auth/signup')
      .send({ email, password: 'owners-passphrase-2', name: 'Owner' });
    expect(owner.status).toBe(201);
    expect(owner.body).toEqual({ id: attacker.body.id, email });

    // The attacker's earlier code was consumed by the re-issue.
    const stale = await http().post('/v1/auth/verify-email').send({ email, code: attackerSession });
    expect(stale.status).not.toBe(200);

    const verify = await http()
      .post('/v1/auth/verify-email')
      .send({ email, code: ctx.mail.lastCodeFor(email)! });
    expect(verify.status).toBe(200);

    const asAttacker = await http()
      .post('/v1/auth/login')
      .send({ email, password: 'attacker-passphrase-1' });
    expect(asAttacker.status).toBe(401);
    expect(asAttacker.body.code).toBe('INVALID_CREDENTIALS');

    const asOwner = await http()
      .post('/v1/auth/login')
      .send({ email, password: 'owners-passphrase-2' });
    expect(asOwner.status).toBe(200);
    const me = await http()
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${asOwner.body.accessToken as string}`);
    expect(me.body.name).toBe('Owner');
  });

  it('signup for an already-verified email is still 409', async () => {
    const email = 'verified-dup@example.com';
    await http().post('/v1/auth/signup').send({ email, password, name: 'First' });
    await http()
      .post('/v1/auth/verify-email')
      .send({ email, code: ctx.mail.lastCodeFor(email)! });

    const again = await http().post('/v1/auth/signup').send({ email, password, name: 'Second' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('X-5: signup over an INVITED clinician row is 409 and mutates nothing', async () => {
    const email = 'invited-clinician@example.com';
    const invited = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: null,
        name: 'Dr Invited',
        role: 'CLINICIAN',
        status: UserStatus.INVITED,
        emailVerifiedAt: null,
      },
    });
    ctx.mail.clear();

    const res = await http()
      .post('/v1/auth/signup')
      .send({ email, password: 'attacker-passphrase-1', name: 'Attacker' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(after.passwordHash).toBeNull();
    expect(after.name).toBe('Dr Invited');
    expect(after.role).toBe('CLINICIAN');
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('B-7: two concurrent refreshes with one token — exactly one succeeds, the other is 401 INVALID_REFRESH_TOKEN', async () => {
    const email = 'race-refresh@example.com';
    await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await ctx.app.get(PasswordService).hash(password),
        name: 'Racer',
        role: 'PARENT',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    const refreshToken = login.body.refreshToken as string;

    const [a, b] = await Promise.all([
      http().post('/v1/auth/refresh').send({ refreshToken }),
      http().post('/v1/auth/refresh').send({ refreshToken }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
    const loser = a.status === 401 ? a : b;
    expect(loser.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('X-4: two concurrent password resets with one token — exactly one succeeds', async () => {
    const email = 'race-reset@example.com';
    await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await ctx.app.get(PasswordService).hash(password),
        name: 'Resetter',
        role: 'PARENT',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const forgot = await http().post('/v1/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(202);
    const token = new URL(ctx.mail.lastResetUrlFor(email)!).searchParams.get('token')!;

    const [a, b] = await Promise.all([
      http().post('/v1/auth/reset-password').send({ token, newPassword: 'brand-new-passphrase-1' }),
      http().post('/v1/auth/reset-password').send({ token, newPassword: 'brand-new-passphrase-2' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.code).toBe('INVALID_RESET_TOKEN');
  });
});

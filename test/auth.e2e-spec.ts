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

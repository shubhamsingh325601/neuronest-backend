import request from 'supertest';
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

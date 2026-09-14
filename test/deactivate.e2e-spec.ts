import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Self-exclusion flow (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  const email = 'leaver@example.com';
  const password = 'a-strong-passphrase';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('signs up, verifies, logs in, then self-deactivates', async () => {
    await http().post('/v1/auth/signup').send({ email, password, name: 'Alex' });
    const code = ctx.mail.lastCodeFor(email)!;
    await http().post('/v1/auth/verify-email').send({ email, code });

    const login = await http().post('/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const accessToken = login.body.accessToken as string;

    const deactivate = await http()
      .post('/v1/users/me/deactivate')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(deactivate.status).toBe(200);
    expect(deactivate.body).toMatchObject({ status: 'DEACTIVATED' });
    expect(deactivate.body.selfExcludedAt).toEqual(expect.any(String));

    // The existing access token is now rejected by the status gate.
    const meAfter = await http()
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meAfter.status).toBe(403);
    expect(meAfter.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    expect(meAfter.headers['content-type']).toContain('application/problem+json');
    expect(meAfter.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/account-not-active',
      title: 'Account Not Active',
      status: 403,
    });
  });

  it('blocks any further login', async () => {
    const res = await http().post('/v1/auth/login').send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});

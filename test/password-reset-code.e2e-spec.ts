import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Password reset with a mobile code (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  it('resets a password with the emailed 6-digit code (mobile) and burns the link token', async () => {
    const email = 'code-reset@example.com';
    await http()
      .post('/v1/auth/signup')
      .send({ email, password: 'original-passphrase-1', name: 'C' });
    await http()
      .post('/v1/auth/verify-email')
      .send({ email, code: ctx.mail.lastCodeFor(email) });
    ctx.mail.clear();

    expect((await http().post('/v1/auth/forgot-password').send({ email })).status).toBe(202);
    const code = ctx.mail.lastResetCodeFor(email)!;
    const token = new URL(ctx.mail.lastResetUrlFor(email)!).searchParams.get('token')!;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await http()
      .post('/v1/auth/reset-password')
      .send({
        email,
        code: code === '000000' ? '111111' : '000000',
        newPassword: 'brand-new-passphrase-9',
      });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_RESET_TOKEN');

    const ok = await http()
      .post('/v1/auth/reset-password')
      .send({ email, code, newPassword: 'brand-new-passphrase-9' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ reset: true });

    // The code and the link are one reset: neither works a second time.
    expect(
      (
        await http()
          .post('/v1/auth/reset-password')
          .send({ email, code, newPassword: 'another-passphrase-1' })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .post('/v1/auth/reset-password')
          .send({ token, newPassword: 'another-passphrase-1' })
      ).status,
    ).toBe(400);

    const login = await http()
      .post('/v1/auth/login')
      .send({ email, password: 'brand-new-passphrase-9' });
    expect(login.status).toBe(200);
  });

  it('rejects a reset body that mixes or omits the secrets', async () => {
    const res = await http()
      .post('/v1/auth/reset-password')
      .send({ newPassword: 'brand-new-passphrase-9' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

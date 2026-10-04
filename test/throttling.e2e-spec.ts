import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Rate limiting is keyed on user id / email / token — never the client IP (decision
 * 2026-10-04: proxy chains differ per host and an IP layer is not needed yet). The IP is
 * therefore irrelevant in both directions: it neither shares a bucket nor can be spoofed.
 */
describe('Identity-keyed rate limiting (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const login = (email: string, headers: Record<string, string> = {}) =>
    http().post('/v1/auth/login').set(headers).send({ email, password: 'whatever-passphrase' });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('caps attempts per email (5/min) with a 429 RATE_LIMITED, and other emails are unaffected', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login('victim@example.com')).status).toBe(401);
    }
    const sixth = await login('victim@example.com');
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');

    expect((await login('someone-else@example.com')).status).toBe(401);
  });

  it('normalises the email, so case/space variants share one bucket', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login('Casey@Example.com');
    }
    expect((await login('  casey@example.COM ')).status).toBe(429);
  });

  it('ignores X-Forwarded-For: a spoofed address neither dodges nor shares the limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(
        (await login('spoofed@example.com', { 'X-Forwarded-For': `203.0.113.${i + 1}` })).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('limits token-only routes per token without storing the raw token', async () => {
    const reset = () =>
      http()
        .post('/v1/auth/reset-password')
        .send({ token: 'x'.repeat(32), newPassword: 'a-new-strong-passphrase' });
    for (let i = 0; i < 5; i += 1) {
      expect((await reset()).status).toBe(400);
    }
    expect((await reset()).status).toBe(429);
  });

  it('does not limit requests that identify nobody (health probes)', async () => {
    for (let i = 0; i < 8; i += 1) {
      expect((await http().get('/health')).status).toBeLessThan(500);
    }
    expect((await http().get('/health')).status).not.toBe(429);
  });

  it('keys authenticated routes on the user id', async () => {
    const passwords = ctx.app.get(PasswordService);
    const password = 'a-strong-passphrase';
    await ctx.prisma.user.create({
      data: {
        email: 'throttle-user@example.com',
        passwordHash: await passwords.hash(password),
        name: 'T',
        role: Role.PARENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: 'throttle-user@example.com', password });
    const token = res.body.accessToken as string;

    // change-password is under the 5/min auth limit, keyed by user (not by body).
    const change = () =>
      http()
        .post('/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrong-current-passphrase',
          newPassword: 'another-strong-passphrase',
        });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await change()).status);
    }
    expect(statuses[5]).toBe(429);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
  });
});

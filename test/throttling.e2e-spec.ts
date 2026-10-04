import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

/** B-2: the rate limiter must key on the real client IP behind a reverse proxy. */
describe('Proxy-aware rate limiting (B-2, e2e)', () => {
  const login = (ctx: TestContext, ip: string) =>
    request(ctx.app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com', password: 'whatever-passphrase' });

  describe('TRUST_PROXY_HOPS=1', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestApp({ trustProxyHops: 1 });
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('gives each forwarded client IP its own /auth bucket', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await login(ctx, '203.0.113.10')).status).toBe(401);
      }
      const sixth = await login(ctx, '203.0.113.10');
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('RATE_LIMITED');

      // A different client behind the same proxy is unaffected.
      expect((await login(ctx, '203.0.113.20')).status).toBe(401);
    });
  });

  describe('TRUST_PROXY_HOPS=0', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestApp({ trustProxyHops: 0 });
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('ignores X-Forwarded-For, so a spoofed header cannot dodge the limit', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await login(ctx, `203.0.113.${i + 1}`)).status);
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses[5]).toBe(429);
    });
  });
});

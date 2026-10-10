import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

/** TEMPORARY probe route (plan 0019 Batch 0.3): authenticated, bounded, synthetic. */
describe('Stream probe (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('requires authentication', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/stream-probe?seconds=1');
    expect(res.status).toBe(401);
  });
});

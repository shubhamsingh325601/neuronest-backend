import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Every error response is RFC 9457 `application/problem+json`. The stable `code`
 * values, status codes, and flow behaviour are unchanged — only the envelope.
 */
describe('Error response shape — RFC 9457 (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('401 — invalid credentials', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/invalid-credentials',
      title: 'Invalid Credentials',
      status: 401,
      instance: '/v1/auth/login',
      code: 'INVALID_CREDENTIALS',
    });
    expect(typeof res.body.detail).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('statusCode');
  });

  it('400 — validation failure carries the joined detail and the `errors` array', async () => {
    const res = await http()
      .post('/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'x' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/validation-error',
      title: 'Validation Error',
      status: 400,
      instance: '/v1/auth/signup',
      code: 'VALIDATION_ERROR',
    });
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.detail).toBe(res.body.errors.join('; '));
  });

  it('404 — unmatched route', async () => {
    const res = await http().get('/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/not-found',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(res.body.instance).toBe('/v1/does-not-exist');
  });
});

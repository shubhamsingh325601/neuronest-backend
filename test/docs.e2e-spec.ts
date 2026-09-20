import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Doc-drift guard. Every endpoint this phase ships must appear in the generated
 * OpenAPI document with the expected path + operationId. Rename or drop a route
 * without updating this list and the build fails here.
 */
const EXPECTED: Array<{ method: string; path: string; operationId: string }> = [
  { method: 'post', path: '/v1/auth/signup', operationId: 'authSignup' },
  { method: 'post', path: '/v1/auth/verify-email', operationId: 'authVerifyEmail' },
  { method: 'post', path: '/v1/auth/resend-verification', operationId: 'authResendVerification' },
  { method: 'post', path: '/v1/auth/login', operationId: 'authLogin' },
  { method: 'post', path: '/v1/auth/refresh', operationId: 'authRefresh' },
  { method: 'post', path: '/v1/auth/logout', operationId: 'authLogout' },
  { method: 'post', path: '/v1/auth/forgot-password', operationId: 'authForgotPassword' },
  { method: 'post', path: '/v1/auth/reset-password', operationId: 'authResetPassword' },
  {
    method: 'post',
    path: '/v1/auth/complete-account-setup',
    operationId: 'authCompleteAccountSetup',
  },
  { method: 'get', path: '/v1/users/me', operationId: 'usersGetMe' },
  { method: 'post', path: '/v1/users/me/deactivate', operationId: 'usersDeactivateMe' },
  {
    method: 'post',
    path: '/v1/clinician-applications',
    operationId: 'clinicianApplicationSubmit',
  },
  {
    method: 'get',
    path: '/v1/clinician-applications',
    operationId: 'clinicianApplicationList',
  },
  {
    method: 'get',
    path: '/v1/clinician-applications/{id}',
    operationId: 'clinicianApplicationGet',
  },
  {
    method: 'post',
    path: '/v1/clinician-applications/{id}/approve',
    operationId: 'clinicianApplicationApprove',
  },
  {
    method: 'post',
    path: '/v1/clinician-applications/{id}/reject',
    operationId: 'clinicianApplicationReject',
  },
  { method: 'get', path: '/v1/health', operationId: 'healthCheck' },
  { method: 'post', path: '/v1/children', operationId: 'childCreate' },
  { method: 'get', path: '/v1/children/{id}', operationId: 'childGet' },
  {
    method: 'post',
    path: '/v1/children/{id}/clinicians',
    operationId: 'childAssignClinician',
  },
];

describe('OpenAPI spec (e2e)', () => {
  let ctx: TestContext;
  let spec: {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const res = await request(ctx.app.getHttpServer()).get('/openapi.json');
    expect(res.status).toBe(200);
    spec = res.body;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it.each(EXPECTED)('documents $method $path as $operationId', ({ method, path, operationId }) => {
    const operation = spec.paths?.[path]?.[method];
    expect(operation).toBeDefined();
    expect(operation.operationId).toBe(operationId);
  });

  it('exposes exactly the endpoints in this phase', () => {
    const documented = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toEqual(
      EXPECTED.map((e) => `${e.method} ${e.path}`).sort(),
    );
  });
});

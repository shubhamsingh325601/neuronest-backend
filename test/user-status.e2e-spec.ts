import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Admin suspend/reactivate lifecycle (A3, plan 0008). `JwtAuthGuard` already re-reads
 * account status on every request (see `deactivate.e2e-spec.ts`), so a suspended
 * user's *existing* access token is rejected immediately — not merely blocked from
 * refresh/login as a "lags until expiry" model might assume. This test asserts the
 * actual (stricter, already-established) behavior.
 */
describe('Admin user suspend/reactivate (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  const createLoggedInUser = async (email: string, role: Role) => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: role,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    return {
      id: user.id,
      token: login.body.accessToken as string,
      refreshToken: login.body.refreshToken as string,
    };
  };
  const asToken = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  let admin: { id: string; token: string };
  let target: { id: string; token: string; refreshToken: string };
  let bystander: { id: string; token: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createLoggedInUser('status-admin@example.com', Role.ADMIN);
    target = await createLoggedInUser('status-target@example.com', Role.PARENT);
    bystander = await createLoggedInUser('status-bystander@example.com', Role.PARENT);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('a non-admin cannot suspend or reactivate', async () => {
    const suspend = await asToken(bystander.token)(
      http().post(`/v1/users/${target.id}/suspend`),
    );
    expect(suspend.status).toBe(403);
    expect(suspend.body.code).toBe('INSUFFICIENT_PERMISSIONS');

    const reactivate = await asToken(bystander.token)(
      http().post(`/v1/users/${target.id}/reactivate`),
    );
    expect(reactivate.status).toBe(403);
    expect(reactivate.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('admin cannot suspend themselves', async () => {
    const res = await asToken(admin.token)(http().post(`/v1/users/${admin.id}/suspend`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CANNOT_SUSPEND_SELF');
  });

  it('suspending an unknown user id is a 404', async () => {
    const res = await asToken(admin.token)(
      http().post('/v1/users/11111111-1111-1111-1111-111111111111/suspend'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('admin suspends the target user, revoking every session immediately', async () => {
    const suspend = await asToken(admin.token)(http().post(`/v1/users/${target.id}/suspend`));
    expect(suspend.status).toBe(200);
    expect(suspend.body).toMatchObject({ id: target.id, status: 'SUSPENDED' });

    // The existing access token is rejected on its very next use.
    const meAfter = await asToken(target.token)(http().get('/v1/users/me'));
    expect(meAfter.status).toBe(403);
    expect(meAfter.body.code).toBe('ACCOUNT_NOT_ACTIVE');

    // Refresh with the pre-suspension refresh token is rejected too.
    const refresh = await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: target.refreshToken });
    expect(refresh.status).toBe(401);
    expect(refresh.body.code).toBe('INVALID_REFRESH_TOKEN');

    // A fresh login attempt is blocked.
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: 'status-target@example.com', password });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('suspending an already-suspended user is idempotent', async () => {
    const res = await asToken(admin.token)(http().post(`/v1/users/${target.id}/suspend`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, status: 'SUSPENDED' });
  });

  it('admin reactivates the target user, restoring login', async () => {
    const reactivate = await asToken(admin.token)(
      http().post(`/v1/users/${target.id}/reactivate`),
    );
    expect(reactivate.status).toBe(200);
    expect(reactivate.body).toMatchObject({ id: target.id, status: 'ACTIVE' });

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: 'status-target@example.com', password });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
  });

  it('reactivating an unknown user id is a 404', async () => {
    const res = await asToken(admin.token)(
      http().post('/v1/users/11111111-1111-1111-1111-111111111111/reactivate'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

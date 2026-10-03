import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Admin user directory (C1, plan 0008): `GET /v1/users` and `GET /v1/users/{id}`. */
describe('Admin user directory (e2e)', () => {
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
    return { id: user.id, token: login.body.accessToken as string };
  };
  const asToken = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  let admin: { id: string; token: string };
  let parent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [admin, parent, clinician] = await Promise.all([
      createLoggedInUser('directory-admin@example.com', Role.ADMIN),
      createLoggedInUser('directory-parent@example.com', Role.PARENT),
      createLoggedInUser('directory-clinician@example.com', Role.CLINICIAN),
    ]);

    const child = await asToken(parent.token)(
      http().post('/v1/children').send({ name: 'Alex', dateOfBirth: '2019-05-14' }),
    );
    childId = child.body.id as string;

    await asToken(admin.token)(
      http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: clinician.id }),
    );
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('a non-admin cannot list or read the directory', async () => {
    const list = await asToken(parent.token)(http().get('/v1/users'));
    expect(list.status).toBe(403);
    expect(list.body.code).toBe('INSUFFICIENT_PERMISSIONS');

    const get = await asToken(parent.token)(http().get(`/v1/users/${clinician.id}`));
    expect(get.status).toBe(403);
    expect(get.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('admin lists every role, filterable by ?role=', async () => {
    const all = await asToken(admin.token)(http().get('/v1/users'));
    expect(all.status).toBe(200);
    expect(all.body.data.some((u: { id: string }) => u.id === parent.id)).toBe(true);
    expect(all.body.data.some((u: { id: string }) => u.id === clinician.id)).toBe(true);
    expect(all.body.data.some((u: { id: string }) => u.id === admin.id)).toBe(true);

    const cliniciansOnly = await asToken(admin.token)(
      http().get('/v1/users').query({ role: 'CLINICIAN' }),
    );
    expect(cliniciansOnly.status).toBe(200);
    expect(
      cliniciansOnly.body.data.every((u: { role: string }) => u.role === 'CLINICIAN'),
    ).toBe(true);
  });

  it('admin reads a PARENT and gets their one child embedded', async () => {
    const res = await asToken(admin.token)(http().get(`/v1/users/${parent.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: parent.id, role: 'PARENT', childId });
    expect(res.body.assignedChildIds).toEqual([]);
  });

  it('admin reads a CLINICIAN and gets assignedChildIds embedded', async () => {
    const res = await asToken(admin.token)(http().get(`/v1/users/${clinician.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: clinician.id, role: 'CLINICIAN' });
    expect(res.body.assignedChildIds).toEqual([childId]);
    expect(res.body.childId).toBeNull();
  });

  it('GET /v1/users/me still resolves the caller, not a users/:id collision', async () => {
    const res = await asToken(admin.token)(http().get('/v1/users/me'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(admin.id);
  });

  it('a non-existent user id is a 404', async () => {
    const res = await asToken(admin.token)(
      http().get('/v1/users/11111111-1111-1111-1111-111111111111'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

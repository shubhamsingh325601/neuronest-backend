import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Media consent record (e2e)', () => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let parent: { id: string; token: string };
  let otherParent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;
  const url = () => `/v1/children/${childId}/consent`;

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, admin] = await Promise.all([
      createLoggedInUser('consent-parent@example.com', Role.PARENT),
      createLoggedInUser('consent-other@example.com', Role.PARENT),
      createLoggedInUser('consent-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('consent-admin@example.com', Role.ADMIN),
    ]);
    const child = await ctx.prisma.child.create({
      data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    childId = child.id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('starts as NONE', async () => {
    const res = await http().get(url()).set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'NONE', current: null, history: [] });
  });

  it('grant persists version and time (201), same version is idempotent (200)', async () => {
    const first = await http().post(url()).set(auth(parent.token)).send({ consentVersion: 'v1' });
    expect(first.status).toBe(201);
    expect(first.body.consentVersion).toBe('v1');
    expect(first.body.grantedAt).toBeDefined();

    const again = await http().post(url()).set(auth(parent.token)).send({ consentVersion: 'v1' });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await ctx.prisma.mediaConsent.count({ where: { childId } })).toBe(1);
  });

  it('rejects an invalid version', async () => {
    const res = await http().post(url()).set(auth(parent.token)).send({ consentVersion: 'bad version!' });
    expect(res.status).toBe(400);
  });

  it('a new version supersedes the open row', async () => {
    const res = await http().post(url()).set(auth(parent.token)).send({ consentVersion: 'v2' });
    expect(res.status).toBe(201);
    const state = await http().get(url()).set(auth(parent.token));
    expect(state.body.status).toBe('GRANTED');
    expect(state.body.current.consentVersion).toBe('v2');
    expect(state.body.history).toHaveLength(2);
    const old = state.body.history.find((h: { consentVersion: string }) => h.consentVersion === 'v1');
    expect(old.supersededAt).not.toBeNull();
  });

  it('withdraw records the time and is idempotent', async () => {
    const res = await http().post(`${url()}/withdraw`).set(auth(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');
    expect(res.body.current).toBeNull();
    const withdrawnAt = res.body.history[0].withdrawnAt;
    expect(withdrawnAt).not.toBeNull();

    const again = await http().post(`${url()}/withdraw`).set(auth(parent.token));
    expect(again.status).toBe(200);
    expect(again.body.history[0].withdrawnAt).toBe(withdrawnAt);
  });

  it('admin can read; clinician and other parents are rejected', async () => {
    expect((await http().get(url()).set(auth(admin.token))).status).toBe(200);
    expect((await http().get(url()).set(auth(clinician.token))).status).toBe(403);
    expect((await http().get(url()).set(auth(otherParent.token))).status).toBe(403);
    expect(
      (await http().post(url()).set(auth(otherParent.token)).send({ consentVersion: 'v1' })).status,
    ).toBe(403);
    expect((await http().post(url()).set(auth(admin.token)).send({ consentVersion: 'v1' })).status).toBe(
      403,
    );
    expect((await http().post(`${url()}/withdraw`).set(auth(clinician.token))).status).toBe(403);
  });

  it('404s for an unknown child', async () => {
    const res = await http()
      .get('/v1/children/00000000-0000-4000-8000-000000000000/consent')
      .set(auth(admin.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });

  it('concurrent grants leave exactly one open row', async () => {
    await ctx.prisma.mediaConsent.deleteMany({ where: { childId } });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        http().post(url()).set(auth(parent.token)).send({ consentVersion: 'v9' }),
      ),
    );
    results.forEach((r) => expect([200, 201]).toContain(r.status));
    const open = await ctx.prisma.mediaConsent.count({
      where: { childId, withdrawnAt: null, supersededAt: null },
    });
    expect(open).toBe(1);
  });
});

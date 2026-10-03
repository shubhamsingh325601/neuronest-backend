import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** D1 (plan 0008): `GET /v1/admin/summary` — fixed-shape counts, ADMIN only. */
describe('Admin summary (e2e)', () => {
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
      createLoggedInUser('summary-admin@example.com', Role.ADMIN),
      createLoggedInUser('summary-parent@example.com', Role.PARENT),
      createLoggedInUser('summary-clinician@example.com', Role.CLINICIAN),
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

  it('a non-admin cannot read the summary', async () => {
    const res = await asToken(parent.token)(http().get('/v1/admin/summary'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('admin reads the fixed-shape summary, reflecting the seeded fixtures', async () => {
    const res = await asToken(admin.token)(http().get('/v1/admin/summary'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pendingClinicianApplications: expect.any(Number),
      activeClinicians: expect.any(Number),
      activeParents: expect.any(Number),
      activePlans: expect.any(Number),
      childrenWithAssignedClinician: expect.any(Number),
      childrenWithoutClinician: expect.any(Number),
    });
    expect(res.body.activeClinicians).toBeGreaterThanOrEqual(1);
    expect(res.body.activeParents).toBeGreaterThanOrEqual(1);
    expect(res.body.childrenWithAssignedClinician).toBeGreaterThanOrEqual(1);
  });
});

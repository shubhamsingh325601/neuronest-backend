import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * `/v1/auth/*` is throttled to 5 req/60s per identity (email / token / user id, never IP —
 * see docs/api-conventions.md), and every actor below only needs one `/v1/auth/login`
 * call (users are seeded directly via Prisma, bypassing signup/verify entirely — same
 * technique as the admin seed in user-status.e2e-spec.ts). All five actors
 * are created once in `beforeAll` and reused across every `it`, to stay well under
 * that budget in a single test run.
 */
describe('Core Care Domain: Child + Clinician↔Child isolation (e2e)', () => {
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

  let parentOwner: { id: string; token: string };
  let parentOther: { id: string; token: string };
  let admin: { id: string; token: string };
  let clinicianAssigned: { id: string; token: string };
  let clinicianOther: { id: string; token: string };
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [parentOwner, parentOther, admin, clinicianAssigned, clinicianOther] = await Promise.all([
      createLoggedInUser('owner@example.com', Role.PARENT),
      createLoggedInUser('other-parent@example.com', Role.PARENT),
      createLoggedInUser('admin@example.com', Role.ADMIN),
      createLoggedInUser('assigned-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('other-clinician@example.com', Role.CLINICIAN),
    ]);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('a parent creates their own child', async () => {
    const res = await asToken(parentOwner.token)(
      http().post('/v1/children').send({ name: 'Alex', dateOfBirth: '2019-05-14' }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Alex', parentId: parentOwner.id });
    childId = res.body.id as string;
  });

  it('a second create by the same parent is a 409', async () => {
    const res = await asToken(parentOwner.token)(
      http().post('/v1/children').send({ name: 'Sam', dateOfBirth: '2020-01-01' }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHILD_ALREADY_EXISTS');
  });

  it('the owning parent can read their child', async () => {
    const res = await asToken(parentOwner.token)(http().get(`/v1/children/${childId}`));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(childId);
  });

  it('a different parent cannot read it', async () => {
    const res = await asToken(parentOther.token)(http().get(`/v1/children/${childId}`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('a non-assigned clinician cannot read it', async () => {
    const res = await asToken(clinicianOther.token)(http().get(`/v1/children/${childId}`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('admin reads it unconditionally', async () => {
    const res = await asToken(admin.token)(http().get(`/v1/children/${childId}`));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(childId);
  });

  it('a non-existent child id is a 404', async () => {
    const res = await asToken(admin.token)(
      http().get('/v1/children/11111111-1111-1111-1111-111111111111'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });

  it('admin assigns a clinician; that clinician can then read the child', async () => {
    const assign = await asToken(admin.token)(
      http()
        .post(`/v1/children/${childId}/clinicians`)
        .send({ clinicianId: clinicianAssigned.id }),
    );
    expect(assign.status).toBe(201);
    expect(assign.body).toMatchObject({
      clinicianId: clinicianAssigned.id,
      childId,
      assignedByAdminId: admin.id,
    });

    const read = await asToken(clinicianAssigned.token)(http().get(`/v1/children/${childId}`));
    expect(read.status).toBe(200);
  });

  it('a clinician not in the assignment still cannot read it', async () => {
    const res = await asToken(clinicianOther.token)(http().get(`/v1/children/${childId}`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('assigning the same clinician again is a 409', async () => {
    const res = await asToken(admin.token)(
      http()
        .post(`/v1/children/${childId}/clinicians`)
        .send({ clinicianId: clinicianAssigned.id }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLINICIAN_ALREADY_ASSIGNED');
  });

  it('assigning a non-clinician user id is a 404', async () => {
    const res = await asToken(admin.token)(
      http()
        .post(`/v1/children/${childId}/clinicians`)
        .send({ clinicianId: parentOwner.id }),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CLINICIAN_NOT_FOUND');
  });

  it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    'assigning a %s clinician is a 409 CLINICIAN_NOT_ACTIVE (X-6)',
    async (status) => {
      const inactive = await ctx.prisma.user.create({
        data: {
          email: `inactive-${status.toLowerCase()}@example.com`,
          name: 'Inactive',
          role: Role.CLINICIAN,
          status,
        },
      });
      const res = await asToken(admin.token)(
        http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: inactive.id }),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLINICIAN_NOT_ACTIVE');
    },
  );

  it('assigning an INVITED clinician is allowed (pre-assignment)', async () => {
    const invited = await ctx.prisma.user.create({
      data: {
        email: 'invited-preassign@example.com',
        name: 'Invited',
        role: Role.CLINICIAN,
        status: UserStatus.INVITED,
      },
    });
    const res = await asToken(admin.token)(
      http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: invited.id }),
    );
    expect(res.status).toBe(201);

    // Later care-team tests assume a single assignment — remove this one.
    await ctx.prisma.clinicianChildAssignment.delete({ where: { id: res.body.id } });
  });

  it('non-admin roles cannot assign a clinician', async () => {
    const res = await asToken(parentOwner.token)(
      http()
        .post(`/v1/children/${childId}/clinicians`)
        .send({ clinicianId: clinicianOther.id }),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  describe('A1: care-team listing', () => {
    it('the owning parent sees the full care team', async () => {
      const res = await asToken(parentOwner.token)(http().get(`/v1/children/${childId}/clinicians`));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ clinicianId: clinicianAssigned.id, childId });
    });

    it('an assigned clinician sees the full care team, not just their own row', async () => {
      const res = await asToken(clinicianAssigned.token)(
        http().get(`/v1/children/${childId}/clinicians`),
      );
      expect(res.status).toBe(200);
      expect(res.body.map((row: { clinicianId: string }) => row.clinicianId)).toEqual([
        clinicianAssigned.id,
      ]);
    });

    it('a different parent is forbidden', async () => {
      const res = await asToken(parentOther.token)(
        http().get(`/v1/children/${childId}/clinicians`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('a non-assigned clinician is forbidden', async () => {
      const res = await asToken(clinicianOther.token)(
        http().get(`/v1/children/${childId}/clinicians`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('admin sees it unconditionally', async () => {
      const res = await asToken(admin.token)(http().get(`/v1/children/${childId}/clinicians`));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('a non-existent child id is a 404', async () => {
      const res = await asToken(admin.token)(
        http().get('/v1/children/11111111-1111-1111-1111-111111111111/clinicians'),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CHILD_NOT_FOUND');
    });
  });

  describe('A2: care-team revocation', () => {
    it('non-admin roles cannot revoke an assignment', async () => {
      const res = await asToken(parentOwner.token)(
        http().delete(`/v1/children/${childId}/clinicians/${clinicianAssigned.id}`),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('revoking on a non-existent child id is a 404', async () => {
      const res = await asToken(admin.token)(
        http().delete(
          `/v1/children/11111111-1111-1111-1111-111111111111/clinicians/${clinicianAssigned.id}`,
        ),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CHILD_NOT_FOUND');
    });

    it('admin revokes the assignment, and the clinician immediately loses every scoped permission', async () => {
      const revoke = await asToken(admin.token)(
        http().delete(`/v1/children/${childId}/clinicians/${clinicianAssigned.id}`),
      );
      expect(revoke.status).toBe(204);

      const childRead = await asToken(clinicianAssigned.token)(
        http().get(`/v1/children/${childId}`),
      );
      expect(childRead.status).toBe(403);
      expect(childRead.body.code).toBe('FORBIDDEN');

      const mediaRead = await asToken(clinicianAssigned.token)(
        http().get(`/v1/children/${childId}/media`),
      );
      expect(mediaRead.status).toBe(403);
      expect(mediaRead.body.code).toBe('FORBIDDEN');

      const planRead = await asToken(clinicianAssigned.token)(
        http().get(`/v1/children/${childId}/plans/today`),
      );
      expect(planRead.status).toBe(403);
      expect(planRead.body.code).toBe('FORBIDDEN');

      const callLogRead = await asToken(clinicianAssigned.token)(
        http().get(`/v1/children/${childId}/call-logs`),
      );
      expect(callLogRead.status).toBe(403);
      expect(callLogRead.body.code).toBe('FORBIDDEN');
    });

    it('revoking an already-revoked assignment is idempotent (204)', async () => {
      const res = await asToken(admin.token)(
        http().delete(`/v1/children/${childId}/clinicians/${clinicianAssigned.id}`),
      );
      expect(res.status).toBe(204);
    });

    it('the care team no longer lists the revoked clinician', async () => {
      const res = await asToken(admin.token)(http().get(`/v1/children/${childId}/clinicians`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});

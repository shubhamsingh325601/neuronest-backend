import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Monthly call log: log a call + list a child's call history, with the same
 * assigned/non-assigned/cross-parent isolation shape as every prior Core Care Domain
 * phase, applied directly via `MonthlyCallLog.childId` (§7 step 5 of plan 0007). All
 * actors are created once in `beforeAll` and reused across every `it`.
 */
describe('Monthly call log: log a call → list history (e2e)', () => {
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
  let parentOwner: { id: string; token: string };
  let parentOther: { id: string; token: string };
  let clinicianAssigned: { id: string; token: string };
  let clinicianOther: { id: string; token: string };
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [admin, parentOwner, parentOther, clinicianAssigned, clinicianOther] = await Promise.all([
      createLoggedInUser('call-log-admin@example.com', Role.ADMIN),
      createLoggedInUser('call-log-owner-parent@example.com', Role.PARENT),
      createLoggedInUser('call-log-other-parent@example.com', Role.PARENT),
      createLoggedInUser('call-log-assigned-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('call-log-other-clinician@example.com', Role.CLINICIAN),
    ]);

    const child = await asToken(parentOwner.token)(
      http().post('/v1/children').send({ name: 'Alex', dateOfBirth: '2019-05-14' }),
    );
    childId = child.body.id as string;

    await asToken(admin.token)(
      http().post(`/v1/children/${childId}/clinicians`).send({ clinicianId: clinicianAssigned.id }),
    );
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('logging a call for a non-existent child is a 404', async () => {
    const res = await asToken(clinicianAssigned.token)(
      http()
        .post('/v1/children/11111111-1111-1111-1111-111111111111/call-logs')
        .send({ calledAt: '2026-09-22T15:30:00.000Z' }),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });

  it('a non-assigned clinician cannot log or list', async () => {
    const logRes = await asToken(clinicianOther.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-09-22T15:30:00.000Z' }),
    );
    expect(logRes.status).toBe(403);
    expect(logRes.body.code).toBe('FORBIDDEN');

    const listRes = await asToken(clinicianOther.token)(
      http().get(`/v1/children/${childId}/call-logs`),
    );
    expect(listRes.status).toBe(403);
    expect(listRes.body.code).toBe('FORBIDDEN');
  });

  it('a parent gets 403 on both endpoints, even for their own child', async () => {
    const logRes = await asToken(parentOwner.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-09-22T15:30:00.000Z' }),
    );
    expect(logRes.status).toBe(403);
    expect(logRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');

    const listRes = await asToken(parentOwner.token)(
      http().get(`/v1/children/${childId}/call-logs`),
    );
    expect(listRes.status).toBe(403);
    expect(listRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('a different parent also gets 403 (double-checking non-ownership does not change the outcome)', async () => {
    const res = await asToken(parentOther.token)(
      http().get(`/v1/children/${childId}/call-logs`),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('an assigned clinician logs a call and lists it back', async () => {
    const created = await asToken(clinicianAssigned.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-09-22T15:30:00.000Z', notes: 'Discussed sleep routine' }),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      childId,
      clinicianId: clinicianAssigned.id,
      notes: 'Discussed sleep routine',
    });

    const list = await asToken(clinicianAssigned.token)(
      http().get(`/v1/children/${childId}/call-logs`),
    );
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(
      list.body.data.some((log: { id: string }) => log.id === created.body.id),
    ).toBe(true);
  });

  it('call history is newest-first', async () => {
    await asToken(clinicianAssigned.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-08-22T10:00:00.000Z', notes: 'Earlier call' }),
    );
    await asToken(clinicianAssigned.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-09-22T10:00:00.000Z', notes: 'Later call' }),
    );
    const list = await asToken(clinicianAssigned.token)(
      http().get(`/v1/children/${childId}/call-logs`),
    );
    const calledAts = (list.body.data as Array<{ calledAt: string }>).map((log) =>
      new Date(log.calledAt).getTime(),
    );
    const sortedDesc = [...calledAts].sort((a, b) => b - a);
    expect(calledAts).toEqual(sortedDesc);
  });

  it('admin can log and list unconditionally for any child', async () => {
    const created = await asToken(admin.token)(
      http()
        .post(`/v1/children/${childId}/call-logs`)
        .send({ calledAt: '2026-09-22T12:00:00.000Z' }),
    );
    expect(created.status).toBe(201);
    expect(created.body.clinicianId).toBe(admin.id);

    const list = await asToken(admin.token)(http().get(`/v1/children/${childId}/call-logs`));
    expect(list.status).toBe(200);
  });

  it('listing a non-existent child is a 404', async () => {
    const res = await asToken(admin.token)(
      http().get('/v1/children/11111111-1111-1111-1111-111111111111/call-logs'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });
});

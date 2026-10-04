import request from 'supertest';
import { JobStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Plan 0011 batch 2: admin job list / get / requeue / run-now, plus the summary's deadJobs. */
describe('Admin jobs (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  let shouldFail = true;

  const login = async (email: string, role: Role) => {
    const passwords = ctx.app.get(PasswordService);
    await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: role,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const res = await http().post('/v1/auth/login').send({ email, password });
    return res.body.accessToken as string;
  };
  const as = (token: string, req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  let admin: string;
  let parent: string;

  const deadJob = () =>
    ctx.prisma.job.create({
      data: {
        type: 'test.flaky',
        payload: { userId: 'u1' },
        status: JobStatus.DEAD,
        attempts: 5,
        lastError: 'provider down',
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.app.get(JobHandlerRegistry).register('test.flaky', async () => {
      if (shouldFail) throw new Error('still failing');
    });
    admin = await login('jobs-admin@example.com', Role.ADMIN);
    parent = await login('jobs-parent@example.com', Role.PARENT);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    shouldFail = true;
    await ctx.prisma.job.deleteMany();
  });

  it('non-admins get 403 on every job route', async () => {
    const job = await deadJob();
    const calls: Array<() => request.Test> = [
      () => http().get('/v1/admin/jobs'),
      () => http().get(`/v1/admin/jobs/${job.id}`),
      () => http().post(`/v1/admin/jobs/${job.id}/requeue`),
      () => http().post('/v1/admin/jobs/run-due'),
    ];
    for (const call of calls) {
      const res = await as(parent, call());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    }
  });

  it('unauthenticated callers get 401', async () => {
    expect((await http().get('/v1/admin/jobs')).status).toBe(401);
  });

  it('admin sees DEAD jobs in the list (filtered) and in the summary', async () => {
    const dead = await deadJob();
    await ctx.prisma.job.create({
      data: { type: 'test.flaky', payload: {}, status: JobStatus.SUCCEEDED },
    });

    const list = await as(admin, http().get('/v1/admin/jobs?status=DEAD'));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: dead.id,
      status: 'DEAD',
      lastError: 'provider down',
      payload: { userId: 'u1' },
    });
    expect(list.body.nextCursor).toBeNull();

    const all = await as(admin, http().get('/v1/admin/jobs?limit=1'));
    expect(all.body.data).toHaveLength(1);
    expect(all.body.nextCursor).not.toBeNull();

    const summary = await as(admin, http().get('/v1/admin/summary'));
    expect(summary.body.deadJobs).toBe(1);
  });

  it('get returns one job, 404 for an unknown id, 400 for a malformed one', async () => {
    const dead = await deadJob();
    expect((await as(admin, http().get(`/v1/admin/jobs/${dead.id}`))).body.id).toBe(dead.id);
    const missing = await as(
      admin,
      http().get('/v1/admin/jobs/00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('JOB_NOT_FOUND');
    expect((await as(admin, http().get('/v1/admin/jobs/not-a-uuid'))).status).toBe(400);
  });

  it('requeue puts a DEAD job back, keeps lastError, and it runs and succeeds', async () => {
    const dead = await deadJob();
    shouldFail = false;

    const res = await as(admin, http().post(`/v1/admin/jobs/${dead.id}/requeue`));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: dead.id, status: 'PENDING', attempts: 0 });
    expect(res.body.lastError).toBe('provider down');
    // inline kick already ran it
    const after = await ctx.prisma.job.findUniqueOrThrow({ where: { id: dead.id } });
    expect(after.status).toBe(JobStatus.SUCCEEDED);
  });

  it('requeue of a non-DEAD job is 409 JOB_NOT_DEAD; unknown is 404', async () => {
    const pending = await ctx.prisma.job.create({
      data: {
        type: 'test.flaky',
        payload: {},
        status: JobStatus.PENDING,
        runAt: new Date(Date.now() + 3_600_000),
      },
    });
    const res = await as(admin, http().post(`/v1/admin/jobs/${pending.id}/requeue`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JOB_NOT_DEAD');

    const missing = await as(
      admin,
      http().post('/v1/admin/jobs/00000000-0000-4000-8000-000000000000/requeue'),
    );
    expect(missing.status).toBe(404);
  });

  it('run-due (admin) processes due jobs and returns counts', async () => {
    shouldFail = false;
    await ctx.prisma.job.create({
      data: {
        type: 'test.flaky',
        payload: {},
        status: JobStatus.PENDING,
        runAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await as(admin, http().post('/v1/admin/jobs/run-due'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
  });
});

import request from 'supertest';
import { JobStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Plan 0011 batch 3: email is sent by queue jobs. A provider failure never changes what the
 * caller sees (fixes the X-3 enumeration oracle), never rolls back business data, retries,
 * ends up DEAD, and an admin requeue then delivers it.
 */
describe('Async email via the job queue (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  // /v1/auth is limited to 5 req/min per IP; give each call its own client address.
  let nextClient = 1;
  const fromNewClient = (req: request.Test) => req.set('X-Forwarded-For', `10.2.0.${nextClient++}`);
  const as = (token: string) => (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const makeDue = () =>
    ctx.prisma.job.updateMany({
      where: { status: JobStatus.PENDING },
      data: { runAt: new Date(0) },
    });

  let admin: { id: string; token: string };

  const createUser = async (email: string, role: Role, verified = true) => {
    const passwords = ctx.app.get(PasswordService);
    return ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: role,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
  };

  beforeAll(async () => {
    ctx = await createTestApp({ trustProxyHops: 1 });
    const user = await createUser('queue-admin@example.com', Role.ADMIN);
    const login = await fromNewClient(
      http().post('/v1/auth/login').send({ email: user.email, password }),
    );
    admin = { id: user.id, token: login.body.accessToken as string };
  });
  beforeEach(async () => {
    ctx.mail.clear();
    ctx.mail.failSends = false;
    await ctx.prisma.job.deleteMany();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('signup', () => {
    it('commits the user and a userId-only job together, and sends the code via the queue', async () => {
      const res = await fromNewClient(
        http().post('/v1/auth/signup').send({ email: 'new@example.com', password, name: 'New' }),
      );
      expect(res.status).toBe(201);

      const jobs = await ctx.prisma.job.findMany();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        type: 'email.verification-code',
        status: JobStatus.SUCCEEDED,
        payload: { userId: res.body.id },
      });
      const code = ctx.mail.lastCodeFor('new@example.com')!;
      expect(code).toMatch(/^\d{6}$/);
      // cardinal rule 7: no secret in the stored payload
      expect(JSON.stringify(jobs[0].payload)).not.toContain(code);

      const verify = await fromNewClient(
        http().post('/v1/auth/verify-email').send({ email: 'new@example.com', code }),
      );
      expect(verify.status).toBe(200);
    });

    it('a provider outage never fails or rolls back signup; the job retries, then delivers', async () => {
      ctx.mail.failSends = true;
      const res = await fromNewClient(
        http().post('/v1/auth/signup').send({ email: 'outage@example.com', password, name: 'O' }),
      );
      expect(res.status).toBe(201);
      expect(await ctx.prisma.user.count({ where: { email: 'outage@example.com' } })).toBe(1);

      const job = await ctx.prisma.job.findFirstOrThrow();
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.attempts).toBe(1);
      expect(job.lastError).toContain('Simulated email provider outage');
      expect(job.runAt.getTime()).toBeGreaterThan(Date.now());

      ctx.mail.failSends = false;
      await makeDue();
      await ctx.jobs.drain();

      expect(ctx.mail.lastCodeFor('outage@example.com')).toBeDefined();
      expect((await ctx.prisma.job.findFirstOrThrow()).status).toBe(JobStatus.SUCCEEDED);
    });

    it('persistent failure → DEAD → admin requeue → delivered', async () => {
      ctx.mail.failSends = true;
      await fromNewClient(
        http().post('/v1/auth/signup').send({ email: 'dead@example.com', password, name: 'D' }),
      );
      const job = await ctx.prisma.job.findFirstOrThrow();
      // Burn the remaining attempts quickly.
      await ctx.prisma.job.update({ where: { id: job.id }, data: { maxAttempts: 2 } });
      await makeDue();
      await ctx.jobs.drain();
      expect((await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        JobStatus.DEAD,
      );

      const listed = await as(admin.token)(http().get('/v1/admin/jobs?status=DEAD'));
      expect(listed.body.data.map((j: { id: string }) => j.id)).toContain(job.id);

      ctx.mail.failSends = false;
      const requeue = await as(admin.token)(http().post(`/v1/admin/jobs/${job.id}/requeue`));
      expect(requeue.status).toBe(200);
      expect(ctx.mail.lastCodeFor('dead@example.com')).toBeDefined();
      expect((await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        JobStatus.SUCCEEDED,
      );
    });
  });

  describe('enumeration safety (cardinal rule 6)', () => {
    const probe = async (path: string, email: string) => {
      const res = await fromNewClient(http().post(path).send({ email }));
      return { status: res.status, body: res.body, type: res.headers['content-type'] };
    };

    it.each(['/v1/auth/forgot-password', '/v1/auth/resend-verification'])(
      '%s answers identically for a known account, an unknown one, and a provider outage',
      async (path) => {
        const knownEmail = `known-${path.split('/').pop()}@example.com`;
        await createUser(knownEmail, Role.PARENT, false);

        const unknown = await probe(path, 'ghost@example.com');
        const known = await probe(path, knownEmail);
        ctx.mail.failSends = true;
        // different minute bucket is irrelevant: the outage must not change the response
        await ctx.prisma.job.deleteMany();
        const knownDuringOutage = await probe(path, knownEmail);

        expect(unknown.status).toBe(202);
        expect(known).toEqual(unknown);
        expect(knownDuringOutage).toEqual(unknown);
      },
    );

    it('forgot-password for an unknown email enqueues nothing and sends nothing', async () => {
      await probe('/v1/auth/forgot-password', 'ghost@example.com');
      expect(await ctx.prisma.job.count()).toBe(0);
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('forgot-password sends the reset link through the queue and the link works', async () => {
      await createUser('reset@example.com', Role.PARENT);
      await probe('/v1/auth/forgot-password', 'reset@example.com');

      const job = await ctx.prisma.job.findFirstOrThrow();
      expect(job.type).toBe('email.password-reset');
      const url = ctx.mail.lastResetUrlFor('reset@example.com')!;
      expect(JSON.stringify(job.payload)).not.toContain(new URL(url).searchParams.get('token')!);

      const token = new URL(url).searchParams.get('token')!;
      const reset = await fromNewClient(
        http().post('/v1/auth/reset-password').send({ token, newPassword: 'brand-new-passphrase' }),
      );
      expect(reset.status).toBe(200);
    });

    it('resend-verification twice within a minute collapses to one queued email', async () => {
      await createUser('twice@example.com', Role.PARENT, false);
      await probe('/v1/auth/resend-verification', 'twice@example.com');
      await probe('/v1/auth/resend-verification', 'twice@example.com');

      expect(await ctx.prisma.job.count()).toBe(1);
      expect(ctx.mail.sent.filter((m) => m.to === 'twice@example.com')).toHaveLength(1);
    });

    it('resend-verification for an already-verified account queues nothing', async () => {
      await createUser('done@example.com', Role.PARENT, true);
      await probe('/v1/auth/resend-verification', 'done@example.com');
      expect(await ctx.prisma.job.count()).toBe(0);
    });
  });

  describe('late jobs are no-ops (state re-checked at run time)', () => {
    it('a verification email is not sent if the user verified before the job ran', async () => {
      ctx.mail.failSends = true;
      const signup = await fromNewClient(
        http().post('/v1/auth/signup').send({ email: 'late@example.com', password, name: 'L' }),
      );
      expect(signup.status).toBe(201);
      await ctx.prisma.user.update({
        where: { email: 'late@example.com' },
        data: { emailVerifiedAt: new Date() },
      });

      ctx.mail.failSends = false;
      await makeDue();
      await ctx.jobs.drain();

      expect(ctx.mail.sent).toHaveLength(0);
      expect((await ctx.prisma.job.findFirstOrThrow()).status).toBe(JobStatus.SUCCEEDED);
    });

    it('an invitation is not sent to a clinician suspended before the job ran', async () => {
      ctx.mail.failSends = true;
      const created = await as(admin.token)(
        http().post('/v1/clinicians').send({ name: 'Dr. Late', email: 'drlate@clinic.example' }),
      );
      expect(created.status).toBe(201);
      ctx.mail.failSends = false;
      await as(admin.token)(http().post(`/v1/users/${created.body.id}/suspend`));

      await makeDue();
      await ctx.jobs.drain();

      expect(ctx.mail.sent).toHaveLength(0);
      expect((await ctx.prisma.job.findFirstOrThrow()).status).toBe(JobStatus.SUCCEEDED);
    });
  });

  describe('clinician invitations', () => {
    it('create → outage → still 201/INVITED → job retries → admin resend still works', async () => {
      ctx.mail.failSends = true;
      const created = await as(admin.token)(
        http().post('/v1/clinicians').send({ name: 'Dr. Retry', email: 'retry@clinic.example' }),
      );
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('INVITED');
      const job = await ctx.prisma.job.findFirstOrThrow();
      expect(job).toMatchObject({ type: 'email.account-setup', status: JobStatus.PENDING });
      expect(job.payload).toEqual({ userId: created.body.id });

      ctx.mail.failSends = false;
      const resend = await as(admin.token)(
        http().post(`/v1/clinicians/${created.body.id}/resend-invitation`),
      );
      expect(resend.status).toBe(202);
      expect(ctx.mail.lastSetupUrlFor('retry@clinic.example')).toBeDefined();
    });

    it('changing an INVITED clinician’s email kills the old link at once and invites the new address', async () => {
      const created = await as(admin.token)(
        http().post('/v1/clinicians').send({ name: 'Dr. Move', email: 'move-old@clinic.example' }),
      );
      const oldToken = new URL(
        ctx.mail.lastSetupUrlFor('move-old@clinic.example')!,
      ).searchParams.get('token')!;

      ctx.mail.failSends = true; // new invite is still queued, not yet delivered
      const patch = await as(admin.token)(
        http()
          .patch(`/v1/clinicians/${created.body.id}`)
          .send({ email: 'move-new@clinic.example' }),
      );
      expect(patch.status).toBe(200);

      const attempt = await fromNewClient(
        http()
          .post('/v1/auth/complete-account-setup')
          .send({ token: oldToken, password: 'chosen-strong-passphrase' }),
      );
      expect(attempt.status).toBe(400);

      ctx.mail.failSends = false;
      await makeDue();
      await ctx.jobs.drain();
      expect(ctx.mail.lastSetupUrlFor('move-new@clinic.example')).toBeDefined();
    });
  });
});

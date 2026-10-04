import request from 'supertest';
import { JobStatus, MediaStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { JobSweepService } from '@common/jobs/job-sweep.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Plan 0011 batch 4 (B-8): the recurring job that expires stale PENDING upload tickets. */
describe('Stale media cleanup (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  let parentToken: string;
  let childId: string;

  const ticket = async (createdAt: Date) => {
    const res = await http()
      .post(`/v1/children/${childId}/media/upload-tickets`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ type: 'PHOTO' });
    expect(res.status).toBe(201);
    const id = res.body.mediaId ?? res.body.id ?? res.body.media?.id;
    await ctx.prisma.media.update({ where: { id }, data: { createdAt } });
    return id as string;
  };
  const statusOf = async (id: string) =>
    (await ctx.prisma.media.findUniqueOrThrow({ where: { id } })).status;
  const sweep = () => ctx.app.get(JobSweepService).sweep();

  beforeAll(async () => {
    ctx = await createTestApp();
    const passwords = ctx.app.get(PasswordService);
    await ctx.prisma.user.create({
      data: {
        email: 'cleanup-parent@example.com',
        passwordHash: await passwords.hash(password),
        name: 'Parent',
        role: Role.PARENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: 'cleanup-parent@example.com', password });
    parentToken = login.body.accessToken as string;
    const child = await http()
      .post('/v1/children')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ name: 'Alex', dateOfBirth: '2019-05-14' });
    childId = child.body.id as string;
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.prisma.job.deleteMany();
  });

  it('flips only PENDING tickets older than the TTL to FAILED', async () => {
    const stale = await ticket(hoursAgo(25));
    const recent = await ticket(hoursAgo(1));
    const justUnder = await ticket(hoursAgo(23));

    await sweep();

    expect(await statusOf(stale)).toBe(MediaStatus.FAILED);
    expect(await statusOf(recent)).toBe(MediaStatus.PENDING);
    expect(await statusOf(justUnder)).toBe(MediaStatus.PENDING);
  });

  it('the sweep enqueues one job per hour (dedupeKey) and running twice is a no-op', async () => {
    const stale = await ticket(hoursAgo(30));

    await sweep();
    await sweep();

    const jobs = await ctx.prisma.job.findMany({ where: { type: 'media.expire-stale-pending' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe(JobStatus.SUCCEEDED);
    expect(await statusOf(stale)).toBe(MediaStatus.FAILED);
  });

  it('never touches UPLOADED or already-FAILED rows', async () => {
    const uploaded = await ticket(hoursAgo(48));
    await ctx.prisma.media.update({
      where: { id: uploaded },
      data: { status: MediaStatus.UPLOADED },
    });
    const failed = await ticket(hoursAgo(48));
    await ctx.prisma.media.update({ where: { id: failed }, data: { status: MediaStatus.FAILED } });

    await sweep();

    expect(await statusOf(uploaded)).toBe(MediaStatus.UPLOADED);
    expect(await statusOf(failed)).toBe(MediaStatus.FAILED);
  });

  it('after expiry: re-confirming FAILED is an idempotent no-op; UPLOADED is 409 MEDIA_ALREADY_CONFIRMED', async () => {
    const stale = await ticket(hoursAgo(40));
    await sweep();
    expect(await statusOf(stale)).toBe(MediaStatus.FAILED);

    const again = await http()
      .post(`/v1/media/${stale}/confirm`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ status: 'FAILED' });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('FAILED');

    const late = await http()
      .post(`/v1/media/${stale}/confirm`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ status: 'UPLOADED' });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('MEDIA_ALREADY_CONFIRMED');
  });
});

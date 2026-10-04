import request from 'supertest';
import { JobStatus, type Prisma } from '@prisma/client';
import { JobHandlerRegistry, type JobContext } from '@common/jobs/job-handler.registry';
import { createTestApp, type TestContext } from './helpers/test-app';

/** Plan 0011 batch 1: queue core — dedupe, claim concurrency, retry/DEAD, stale reset, release, run-due. */
describe('Job queue (e2e)', () => {
  let ctx: TestContext;
  let work: (job: JobContext) => Promise<void> = async () => undefined;

  const enqueue = (spec: {
    dedupeKey?: string;
    payload?: Prisma.InputJsonObject;
    maxAttempts?: number;
  }) =>
    ctx.jobs.queue.enqueue(ctx.prisma, { ...spec, type: 'test.work', payload: spec.payload ?? {} });

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.app.get(JobHandlerRegistry).register('test.work', (job) => work(job));
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    work = async () => undefined;
    await ctx.prisma.job.deleteMany();
  });

  it('dedupeKey makes enqueue idempotent', async () => {
    expect(await enqueue({ dedupeKey: 'same' })).toBe(true);
    expect(await enqueue({ dedupeKey: 'same' })).toBe(false);
    expect(await ctx.prisma.job.count()).toBe(1);
  });

  it('enqueue inside a rolled-back transaction leaves no job (outbox atomicity)', async () => {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await ctx.jobs.queue.enqueue(tx, { type: 'test.work', payload: {} });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await ctx.prisma.job.count()).toBe(0);
  });

  it('two concurrent runners process each job exactly once', async () => {
    const seen: string[] = [];
    work = async (job) => {
      seen.push(job.id);
      await new Promise((r) => setTimeout(r, 5));
    };
    for (let i = 0; i < 25; i++) await enqueue({ payload: { i } });

    const [a, b] = await Promise.all([ctx.jobs.runner.runDue(), ctx.jobs.runner.runDue()]);

    expect(a.succeeded + b.succeeded).toBe(25);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(await ctx.prisma.job.count({ where: { status: JobStatus.SUCCEEDED } })).toBe(25);
  });

  it('a failing job is rescheduled with a later runAt, then succeeds when due again', async () => {
    let calls = 0;
    work = async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
    };
    await enqueue({});

    const first = await ctx.jobs.runner.runDue();
    expect(first.retried).toBe(1);
    const row = await ctx.prisma.job.findFirstOrThrow();
    expect(row.status).toBe(JobStatus.PENDING);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('transient');
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 10_000);

    // not due yet -> nothing claimed
    expect((await ctx.jobs.runner.runDue()).claimed).toBe(0);

    await ctx.prisma.job.update({ where: { id: row.id }, data: { runAt: new Date(0) } });
    const second = await ctx.jobs.runner.runDue();
    expect(second.succeeded).toBe(1);
    expect((await ctx.prisma.job.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      JobStatus.SUCCEEDED,
    );
  });

  it('turns DEAD at maxAttempts', async () => {
    work = async () => {
      throw new Error('always');
    };
    await enqueue({ maxAttempts: 2 });

    await ctx.jobs.runner.runDue();
    await ctx.prisma.job.updateMany({ data: { runAt: new Date(0) } });
    const second = await ctx.jobs.runner.runDue();

    expect(second.dead).toBe(1);
    const row = await ctx.prisma.job.findFirstOrThrow();
    expect(row.status).toBe(JobStatus.DEAD);
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBe('always');
  });

  it('resets a stale RUNNING job back to PENDING, and to DEAD when out of attempts', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    const stale = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 1,
        lockedAt: old,
        lockedBy: 'gone',
      },
    });
    const exhausted = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 5,
        lockedAt: old,
        lockedBy: 'gone',
      },
    });
    const fresh = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 1,
        lockedAt: new Date(),
        lockedBy: 'live',
      },
    });

    const result = await ctx.jobs.runner.reapStale();

    expect(result).toMatchObject({ reset: 1, dead: 1 });
    const byId = async (id: string) => ctx.prisma.job.findUniqueOrThrow({ where: { id } });
    expect((await byId(stale.id)).status).toBe(JobStatus.PENDING);
    expect((await byId(stale.id)).lockedBy).toBeNull();
    expect((await byId(exhausted.id)).status).toBe(JobStatus.DEAD);
    expect((await byId(fresh.id)).status).toBe(JobStatus.RUNNING);
  });

  it('prunes old SUCCEEDED rows but never DEAD ones', async () => {
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    await ctx.prisma.job.create({
      data: { type: 'test.work', payload: {}, status: JobStatus.SUCCEEDED, completedAt: longAgo },
    });
    await ctx.prisma.job.create({
      data: { type: 'test.work', payload: {}, status: JobStatus.DEAD, completedAt: longAgo },
    });
    const result = await ctx.jobs.runner.reapStale();
    expect(result.pruned).toBe(1);
    expect(await ctx.prisma.job.count({ where: { status: JobStatus.DEAD } })).toBe(1);
  });

  it('releases this instance’s RUNNING jobs on shutdown without charging the attempt', async () => {
    const mine = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 2,
        lockedAt: new Date(),
        lockedBy: ctx.jobs.runner.instanceId,
      },
    });
    const other = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 2,
        lockedAt: new Date(),
        lockedBy: 'someone-else',
      },
    });

    expect(await ctx.jobs.runner.releaseHeld()).toBe(1);

    const released = await ctx.prisma.job.findUniqueOrThrow({ where: { id: mine.id } });
    expect(released.status).toBe(JobStatus.PENDING);
    expect(released.attempts).toBe(1);
    expect((await ctx.prisma.job.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      JobStatus.RUNNING,
    );
  });

  it('fences a stale worker: it cannot overwrite a re-claimed job', async () => {
    const row = await ctx.prisma.job.create({
      data: {
        type: 'test.work',
        payload: {},
        status: JobStatus.RUNNING,
        attempts: 1,
        lockedAt: new Date(1_000),
        lockedBy: 'old',
      },
    });
    // The job was re-claimed by another worker (different lockedAt); the first worker's
    // completion carries its original lockedAt and must match nothing.
    await ctx.prisma.job.update({
      where: { id: row.id },
      data: { lockedAt: new Date(2_000), lockedBy: 'new' },
    });
    const stale = await ctx.prisma.job.updateMany({
      where: { id: row.id, status: JobStatus.RUNNING, lockedAt: new Date(1_000) },
      data: { status: JobStatus.SUCCEEDED },
    });
    expect(stale.count).toBe(0);
  });

  it('rejects enqueueing an unregistered type', async () => {
    await expect(ctx.jobs.queue.enqueue(ctx.prisma, { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown job type/,
    );
  });
});

describe('Job run-due machine trigger (e2e)', () => {
  const TOKEN = 'x'.repeat(40);

  describe('when JOBS_RUN_TOKEN is unset', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      delete process.env.JOBS_RUN_TOKEN;
      ctx = await createTestApp();
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('is disabled (404)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/v1/jobs/run-due')
        .set('X-Jobs-Token', TOKEN);
      expect(res.status).toBe(404);
    });
  });

  describe('when JOBS_RUN_TOKEN is set', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      process.env.JOBS_RUN_TOKEN = TOKEN;
      ctx = await createTestApp();
      ctx.app.get(JobHandlerRegistry).register('test.work', async () => undefined);
    });
    afterAll(async () => {
      delete process.env.JOBS_RUN_TOKEN;
      await ctx.close();
    });

    it('401s a missing or wrong token', async () => {
      const http = () => request(ctx.app.getHttpServer());
      const missing = await http().post('/v1/jobs/run-due');
      expect(missing.status).toBe(401);
      expect(missing.body.code).toBe('INVALID_JOBS_TOKEN');
      const wrong = await http().post('/v1/jobs/run-due').set('X-Jobs-Token', 'y'.repeat(40));
      expect(wrong.status).toBe(401);
    });

    it('200s with outcome counts for the right token', async () => {
      await ctx.jobs.queue.enqueue(ctx.prisma, { type: 'test.work', payload: {} });
      const res = await request(ctx.app.getHttpServer())
        .post('/v1/jobs/run-due')
        .set('X-Jobs-Token', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
    });
  });
});

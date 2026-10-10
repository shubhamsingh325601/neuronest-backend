import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Parent-raised escalations (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  const createLoggedInUser = async (email: string, role: Role, name: string = role) => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name,
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
  let strangerClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;
  let otherChildId: string;
  const url = () => `/v1/children/${childId}/escalations`;
  const body = {
    categoryId: 'sensory_overload',
    notes: 'Meltdown after a loud noise',
    callbackPhone: '+44 7700 900123',
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, strangerClinician, admin] = await Promise.all([
      createLoggedInUser('es-parent@example.com', Role.PARENT),
      createLoggedInUser('es-other@example.com', Role.PARENT),
      createLoggedInUser('es-clinician@example.com', Role.CLINICIAN, 'Dr. E. Okafor'),
      createLoggedInUser('es-stranger@example.com', Role.CLINICIAN),
      createLoggedInUser('es-admin@example.com', Role.ADMIN),
    ]);
    childId = (
      await ctx.prisma.child.create({
        data: { parentId: parent.id, name: 'Aarav', dateOfBirth: new Date('2019-05-14') },
      })
    ).id;
    otherChildId = (
      await ctx.prisma.child.create({
        data: { parentId: otherParent.id, name: 'Zed', dateOfBirth: new Date('2019-05-14') },
      })
    ).id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('has no active request at first (404)', async () => {
    const res = await http().get(`${url()}/active`).set(auth(parent.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ESCALATION_NOT_FOUND');
  });

  it('validates the request', async () => {
    const send = (b: object) => http().post(url()).set(auth(parent.token)).send(b);
    expect((await send({ ...body, categoryId: 'nope' })).status).toBe(400);
    expect((await send({ ...body, notes: '' })).status).toBe(400);
    expect((await send({ ...body, callbackPhone: 'call me' })).status).toBe(400);
  });

  it("only the child's own parent can raise one", async () => {
    for (const who of [otherParent, clinician, admin]) {
      expect((await http().post(url()).set(auth(who.token)).send(body)).status).toBe(403);
    }
  });

  it('raises a request due in 24 h and allows only one active request', async () => {
    const res = await http().post(url()).set(auth(parent.token)).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      categoryId: 'sensory_overload',
      overdue: false,
      assignedClinician: { name: 'Dr. E. Okafor' },
    });
    const hours =
      (new Date(res.body.dueAt).getTime() - new Date(res.body.createdAt).getTime()) / 3_600_000;
    expect(hours).toBe(24);

    const pushed = await ctx.push.waitFor('Urgent request');
    expect(pushed.userIds).toEqual([clinician.id]);
    expect(pushed.message.data).toMatchObject({
      type: 'escalation_created',
      escalationId: res.body.id,
    });

    const again = await http().post(url()).set(auth(parent.token)).send(body);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ESCALATION_ALREADY_ACTIVE');

    const concurrent = await Promise.all([
      http()
        .post(`/v1/children/${otherChildId}/escalations`)
        .set(auth(otherParent.token))
        .send(body),
      http()
        .post(`/v1/children/${otherChildId}/escalations`)
        .set(auth(otherParent.token))
        .send(body),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('shows the active request to the parent, the assigned clinician and the admin only', async () => {
    for (const who of [parent, clinician, admin]) {
      const res = await http().get(`${url()}/active`).set(auth(who.token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OPEN');
    }
    for (const who of [otherParent, strangerClinician]) {
      expect((await http().get(`${url()}/active`).set(auth(who.token))).status).toBe(403);
    }
  });

  describe('clinician review', () => {
    let id: string;
    beforeAll(async () => {
      id = (await http().get(`${url()}/active`).set(auth(parent.token))).body.id;
    });

    it('is forbidden for the parent and an unassigned clinician', async () => {
      for (const who of [parent, strangerClinician]) {
        expect(
          (await http().post(`/v1/escalations/${id}/acknowledge`).set(auth(who.token))).status,
        ).toBe(403);
        expect(
          (await http().post(`/v1/escalations/${id}/resolve`).set(auth(who.token)).send({})).status,
        ).toBe(403);
      }
    });

    it("lists the queue scoped to the clinician's children and filters overdue", async () => {
      const mine = await http().get('/v1/escalations').set(auth(clinician.token));
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((e: { id: string }) => e.id)).toEqual([id]);

      const everything = await http().get('/v1/escalations').set(auth(admin.token));
      expect(everything.body.data.length).toBeGreaterThanOrEqual(2);

      expect(
        (await http().get('/v1/escalations?overdue=true').set(auth(clinician.token))).body.data,
      ).toEqual([]);
      await ctx.prisma.escalation.update({
        where: { id },
        data: { dueAt: new Date(Date.now() - 60_000) },
      });
      const overdue = await http().get('/v1/escalations?overdue=true').set(auth(clinician.token));
      expect(overdue.body.data).toHaveLength(1);
      expect(overdue.body.data[0].overdue).toBe(true);

      expect((await http().get('/v1/escalations').set(auth(parent.token))).status).toBe(403);
      expect(
        (await http().get('/v1/escalations').set(auth(strangerClinician.token))).body.data,
      ).toEqual([]);
    });

    it('acknowledges then resolves with a note the parent can read; both are idempotent', async () => {
      ctx.push.clear();
      const ack = await http().post(`/v1/escalations/${id}/acknowledge`).set(auth(clinician.token));
      expect(ack.status).toBe(200);
      expect(ack.body.status).toBe('ACKNOWLEDGED');
      const ackAt = ack.body.acknowledgedAt;
      expect(
        (await http().post(`/v1/escalations/${id}/acknowledge`).set(auth(clinician.token))).body
          .acknowledgedAt,
      ).toBe(ackAt);

      const done = await http()
        .post(`/v1/escalations/${id}/resolve`)
        .set(auth(clinician.token))
        .send({ note: 'Please try the calm-down steps and book a call.' });
      expect(done.body).toMatchObject({
        status: 'RESOLVED',
        resolutionNote: 'Please try the calm-down steps and book a call.',
      });
      expect(
        (await http().post(`/v1/escalations/${id}/resolve`).set(auth(admin.token)).send({})).body
          .status,
      ).toBe('RESOLVED');

      // The parent hears about each change once; repeating a step does not notify again.
      const seen = await ctx.push.waitFor('Your request was seen');
      expect(seen.userIds).toEqual([parent.id]);
      const answered = await ctx.push.waitFor('Your request was answered');
      expect(answered.userIds).toEqual([parent.id]);
      expect(ctx.push.sent.map((p) => p.message.title)).toEqual([
        'Your request was seen',
        'Your request was answered',
      ]);

      const parentView = await http().get(`${url()}`).set(auth(parent.token));
      expect(parentView.body.data[0]).toMatchObject({ status: 'RESOLVED', overdue: false });
      expect((await http().get(`${url()}/active`).set(auth(parent.token))).status).toBe(404);
    });

    it('lets the parent raise a new request after a resolved one, and cancel it', async () => {
      const fresh = await http()
        .post(url())
        .set(auth(parent.token))
        .send({ categoryId: 'sleep_routine_crisis', notes: 'Awake all night' });
      expect(fresh.status).toBe(201);
      const cancelled = await http()
        .post(`/v1/escalations/${fresh.body.id}/cancel`)
        .set(auth(parent.token));
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(
        (await http().post(`/v1/escalations/${fresh.body.id}/cancel`).set(auth(parent.token)))
          .status,
      ).toBe(200);
      expect(
        (
          await http()
            .post(`/v1/escalations/${fresh.body.id}/acknowledge`)
            .set(auth(clinician.token))
        ).status,
      ).toBe(409);
      expect(
        (await http().post(`/v1/escalations/${id}/cancel`).set(auth(parent.token))).status,
      ).toBe(409);
      expect(
        (await http().post(`/v1/escalations/${fresh.body.id}/cancel`).set(auth(otherParent.token)))
          .status,
      ).toBe(403);
    });
  });
});

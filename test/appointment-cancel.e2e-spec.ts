import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

const HOUR = 3_600_000;
const at = (hours: number): string =>
  new Date(Math.floor((Date.now() + hours * HOUR) / 1000) * 1000).toISOString();

describe('Cancel a booked call (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createLoggedInUser = async (email: string, role: Role) => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: `${role} ${email.split('@')[0]}`,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await http().post('/v1/auth/login').send({ email, password });
    return { id: user.id, token: login.body.accessToken as string };
  };

  let parent: { id: string; token: string };
  let otherParent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;

  const newSlot = async (hours: number) => {
    const res = await http()
      .post('/v1/appointment-slots')
      .set(auth(clinician.token))
      .send({ startsAt: at(hours), endsAt: at(hours + 0.5) });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const book = async (slotId: string) => {
    const res = await http()
      .post(`/v1/children/${childId}/appointments`)
      .set(auth(parent.token))
      .send({ slotId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    parent = await createLoggedInUser('cancel-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('cancel-other@example.com', Role.PARENT);
    clinician = await createLoggedInUser('cancel-clinician@example.com', Role.CLINICIAN);
    admin = await createLoggedInUser('cancel-admin@example.com', Role.ADMIN);
    childId = (
      await ctx.prisma.child.create({
        data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
      })
    ).id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('cancels the parent’s own booking and frees the slot for booking again', async () => {
    const slotId = await newSlot(400);
    const appointmentId = await book(slotId);

    const res = await http().delete(`/v1/appointments/${appointmentId}`).set(auth(parent.token));
    expect(res.status).toBe(204);

    const free = await http()
      .get(`/v1/children/${childId}/appointment-slots`)
      .set(auth(parent.token));
    expect(free.body.data.map((s: { id: string }) => s.id)).toContain(slotId);
    await book(slotId);
  });

  it('is forbidden for another parent, the clinician and the admin', async () => {
    const appointmentId = (
      await ctx.prisma.appointment.findFirstOrThrow({ where: { childId } })
    ).id;
    for (const who of [otherParent, clinician, admin]) {
      const res = await http().delete(`/v1/appointments/${appointmentId}`).set(auth(who.token));
      expect(res.status).toBe(403);
    }
  });

  it('404s an unknown appointment and 401s without a token', async () => {
    const missing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      (await http().delete(`/v1/appointments/${missing}`).set(auth(parent.token))).status,
    ).toBe(404);
    expect((await http().delete(`/v1/appointments/${missing}`)).status).toBe(401);
  });

  it('refuses to cancel a call that has already started', async () => {
    const appointment = await ctx.prisma.appointment.findFirstOrThrow({ where: { childId } });
    await ctx.prisma.appointmentSlot.update({
      where: { id: appointment.slotId },
      data: { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) },
    });
    const res = await http().delete(`/v1/appointments/${appointment.id}`).set(auth(parent.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPOINTMENT_STARTED');
  });
});

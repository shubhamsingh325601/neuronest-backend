import request from 'supertest';
import { PlanStatus, PlanTemplateStatus, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

const HOUR = 3_600_000;
const at = (hours: number): string =>
  new Date(Math.floor((Date.now() + hours * HOUR) / 1000) * 1000).toISOString();

describe('Call preparation, call summary, meeting link, preferences and rich coaching (e2e)', () => {
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
  let otherClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;
  let appointmentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    parent = await createLoggedInUser('pcp-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('pcp-other@example.com', Role.PARENT);
    clinician = await createLoggedInUser('pcp-clinician@example.com', Role.CLINICIAN);
    otherClinician = await createLoggedInUser('pcp-clinician2@example.com', Role.CLINICIAN);
    admin = await createLoggedInUser('pcp-admin@example.com', Role.ADMIN);
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

  describe('meeting link and booking', () => {
    it('publishes a slot with an https link and returns it on the parent’s appointment', async () => {
      const slot = await http()
        .post('/v1/appointment-slots')
        .set(auth(clinician.token))
        .send({ startsAt: at(48), endsAt: at(48.5), meetingUrl: 'https://meet.example.com/abc' });
      expect(slot.status).toBe(201);

      const booked = await http()
        .post(`/v1/children/${childId}/appointments`)
        .set(auth(parent.token))
        .send({ slotId: slot.body.id });
      expect(booked.status).toBe(201);
      expect(booked.body).toMatchObject({
        meetingUrl: 'https://meet.example.com/abc',
        prepTopicIds: [],
        prepChecklistIds: [],
        summary: null,
        actionPoints: [],
      });
      appointmentId = booked.body.id;
    });

    it('rejects a non-https meeting link', async () => {
      const res = await http()
        .post('/v1/appointment-slots')
        .set(auth(clinician.token))
        .send({ startsAt: at(60), endsAt: at(60.5), meetingUrl: 'http://meet.example.com/abc' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /appointments/:id/preparation', () => {
    it('saves the parent’s topics and ticks, and shows them on later reads', async () => {
      const res = await http()
        .put(`/v1/appointments/${appointmentId}/preparation`)
        .set(auth(parent.token))
        .send({ topicIds: ['goal-1', 'goal-2'], checklistIds: ['prep_1'] });
      expect(res.status).toBe(200);
      expect(res.body.prepTopicIds).toEqual(['goal-1', 'goal-2']);

      const list = await http()
        .get(`/v1/children/${childId}/appointments?when=upcoming`)
        .set(auth(parent.token));
      expect(list.body.data[0]).toMatchObject({
        id: appointmentId,
        prepTopicIds: ['goal-1', 'goal-2'],
        prepChecklistIds: ['prep_1'],
      });
    });

    it('is forbidden for another parent, the clinician and the admin; 401 without a token', async () => {
      for (const who of [otherParent, clinician, admin]) {
        const res = await http()
          .put(`/v1/appointments/${appointmentId}/preparation`)
          .set(auth(who.token))
          .send({ topicIds: [], checklistIds: [] });
        expect(res.status).toBe(403);
      }
      expect(
        (await http().put(`/v1/appointments/${appointmentId}/preparation`).send({ topicIds: [], checklistIds: [] }))
          .status,
      ).toBe(401);
    });

    it('validates the body and 404s an unknown appointment', async () => {
      expect(
        (
          await http()
            .put(`/v1/appointments/${appointmentId}/preparation`)
            .set(auth(parent.token))
            .send({ topicIds: 'x', checklistIds: [] })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .put('/v1/appointments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/preparation')
            .set(auth(parent.token))
            .send({ topicIds: [], checklistIds: [] })
        ).status,
      ).toBe(404);
    });
  });

  describe('PUT /appointments/:id/summary', () => {
    it('refuses before the call has started', async () => {
      const res = await http()
        .put(`/v1/appointments/${appointmentId}/summary`)
        .set(auth(clinician.token))
        .send({ summary: 'Went well', actionPoints: ['Try the timer'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPOINTMENT_NOT_STARTED');
    });

    it('lets the assigned clinician write it once started, and the parent then sees it', async () => {
      const appointment = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      await ctx.prisma.appointmentSlot.update({
        where: { id: appointment.slotId },
        data: { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() - HOUR / 2) },
      });

      const res = await http()
        .put(`/v1/appointments/${appointmentId}/summary`)
        .set(auth(clinician.token))
        .send({ summary: 'Went well', actionPoints: ['Try the timer'] });
      expect(res.status).toBe(200);

      const past = await http()
        .get(`/v1/children/${childId}/appointments?when=past`)
        .set(auth(parent.token));
      expect(past.body.data[0]).toMatchObject({
        id: appointmentId,
        summary: 'Went well',
        actionPoints: ['Try the timer'],
      });
    });

    it('is forbidden for the parent and an unassigned clinician; admin may write', async () => {
      const body = { summary: 'x', actionPoints: [] };
      expect(
        (await http().put(`/v1/appointments/${appointmentId}/summary`).set(auth(parent.token)).send(body))
          .status,
      ).toBe(403);
      expect(
        (await http().put(`/v1/appointments/${appointmentId}/summary`).set(auth(otherClinician.token)).send(body))
          .status,
      ).toBe(403);
      expect(
        (await http().put(`/v1/appointments/${appointmentId}/summary`).set(auth(admin.token)).send(body)).status,
      ).toBe(200);
    });

    it('stops the parent preparing a call that has ended', async () => {
      const res = await http()
        .put(`/v1/appointments/${appointmentId}/preparation`)
        .set(auth(parent.token))
        .send({ topicIds: [], checklistIds: [] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPOINTMENT_ENDED');
    });
  });

  describe('GET/PATCH /users/me/preferences', () => {
    it('returns the defaults, then keeps what the user changes', async () => {
      const first = await http().get('/v1/users/me/preferences').set(auth(parent.token));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        coachingInApp: true,
        coachingEmail: false,
        coachingWhatsapp: false,
        appointmentReminders: true,
        consultationArchive: true,
      });

      const patch = await http()
        .patch('/v1/users/me/preferences')
        .set(auth(parent.token))
        .send({ coachingEmail: true, consultationArchive: false });
      expect(patch.status).toBe(200);

      const again = await http().get('/v1/users/me/preferences').set(auth(parent.token));
      expect(again.body).toMatchObject({ coachingEmail: true, consultationArchive: false, coachingInApp: true });
    });

    it('is per user, rejects unknown settings and needs a token', async () => {
      const other = await http().get('/v1/users/me/preferences').set(auth(otherParent.token));
      expect(other.body.coachingEmail).toBe(false);
      expect(
        (await http().patch('/v1/users/me/preferences').set(auth(parent.token)).send({ unknownSetting: true }))
          .status,
      ).toBe(400);
      expect((await http().get('/v1/users/me/preferences')).status).toBe(401);
    });
  });

  describe('rich coaching tips', () => {
    it('stores and returns the optional guidance fields; omitted ones come back empty', async () => {
      const template = await ctx.prisma.planTemplate.create({
        data: { title: 'T', status: PlanTemplateStatus.PUBLISHED, createdById: admin.id },
      });
      const planId = (
        await ctx.prisma.plan.create({
          data: {
            childId,
            planTemplateId: template.id,
            startDate: new Date(),
            createdById: admin.id,
            status: PlanStatus.ACTIVE,
          },
        })
      ).id;
      const put = await http()
        .put(`/v1/plans/${planId}/coaching/1`)
        .set(auth(clinician.token))
        .send({
          tips: [
            {
              title: 'Two-minute warning',
              body: 'Give a calm heads-up.',
              whyItMatters: 'Helps transitions.',
              steps: ['Get to eye level', 'Say the next step'],
              scriptQuote: 'Two more minutes, then shoes.',
              scriptContext: 'Leaving the house',
            },
            { title: 'Plain tip', body: 'Just a body.' },
          ],
        });
      expect(put.status).toBe(200);
      expect(put.body.tips[0]).toMatchObject({
        whyItMatters: 'Helps transitions.',
        steps: ['Get to eye level', 'Say the next step'],
        scriptQuote: 'Two more minutes, then shoes.',
        scriptContext: 'Leaving the house',
      });
      expect(put.body.tips[1]).toMatchObject({
        whyItMatters: null,
        steps: [],
        scriptQuote: null,
        scriptContext: null,
      });
    });
  });
});
import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

const HOUR = 3_600_000;
/** UTC instant `hours` from now, on a whole-second boundary. */
const at = (hours: number): string =>
  new Date(Math.floor((Date.now() + hours * HOUR) / 1000) * 1000).toISOString();

describe('Monthly call appointments (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';

  const createLoggedInUser = async (
    email: string,
    role: Role,
    status: UserStatus = UserStatus.ACTIVE,
  ) => {
    const passwords = ctx.app.get(PasswordService);
    const user = await ctx.prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(password),
        name: `${role} ${email.split('@')[0]}`,
        role,
        status,
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
  let otherClinician: { id: string; token: string };
  let unassignedClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;
  let otherChildId: string;

  const publish = (token: string, body: unknown) =>
    http().post('/v1/appointment-slots').set(auth(token)).send(body as object);
  const listSlots = (token: string, id = childId, qs = '') =>
    http().get(`/v1/children/${id}/appointment-slots${qs}`).set(auth(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    // Sequential: six parallel logins against ephemeral supertest servers can ECONNRESET.
    parent = await createLoggedInUser('appt-parent@example.com', Role.PARENT);
    otherParent = await createLoggedInUser('appt-other-parent@example.com', Role.PARENT);
    clinician = await createLoggedInUser('appt-clinician@example.com', Role.CLINICIAN);
    otherClinician = await createLoggedInUser('appt-clinician-2@example.com', Role.CLINICIAN);
    unassignedClinician = await createLoggedInUser('appt-clinician-3@example.com', Role.CLINICIAN);
    admin = await createLoggedInUser('appt-admin@example.com', Role.ADMIN);
    const [child, otherChild] = await Promise.all([
      ctx.prisma.child.create({
        data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
      }),
      ctx.prisma.child.create({
        data: { parentId: otherParent.id, name: 'Sam', dateOfBirth: new Date('2018-03-02') },
      }),
    ]);
    childId = child.id;
    otherChildId = otherChild.id;
    await ctx.prisma.clinicianChildAssignment.createMany({
      data: [
        { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
        { clinicianId: otherClinician.id, childId, assignedByAdminId: admin.id },
        { clinicianId: unassignedClinician.id, childId: otherChildId, assignedByAdminId: admin.id },
      ],
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /v1/appointment-slots', () => {
    it('a clinician publishes their own slot (201, clinician id + name only)', async () => {
      const res = await publish(clinician.token, { startsAt: at(48), endsAt: at(48.5) });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        clinician: { id: clinician.id, name: expect.any(String) },
        startsAt: at(48),
        endsAt: at(48.5),
      });
      expect(Object.keys(res.body.clinician).sort()).toEqual(['id', 'name']);
    });

    it('an admin publishes for a clinician; clinicianId is required for an admin', async () => {
      const ok = await publish(admin.token, {
        clinicianId: otherClinician.id,
        startsAt: at(72),
        endsAt: at(72.5),
      });
      expect(ok.status).toBe(201);
      expect(ok.body.clinician.id).toBe(otherClinician.id);

      const missing = await publish(admin.token, { startsAt: at(80), endsAt: at(80.5) });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('CLINICIAN_ID_REQUIRED');
    });

    it('a clinician cannot publish for another clinician (403)', async () => {
      const res = await publish(clinician.token, {
        clinicianId: otherClinician.id,
        startsAt: at(90),
        endsAt: at(90.5),
      });
      expect(res.status).toBe(403);
    });

    it('a parent cannot publish (403) and an anonymous caller is 401', async () => {
      const res = await publish(parent.token, { startsAt: at(90), endsAt: at(90.5) });
      expect(res.status).toBe(403);
      const anon = await http()
        .post('/v1/appointment-slots')
        .send({ startsAt: at(90), endsAt: at(90.5) });
      expect(anon.status).toBe(401);
    });

    it('overlapping slots for one clinician are 409 SLOT_OVERLAP; adjacent slots are fine', async () => {
      const first = await publish(clinician.token, { startsAt: at(100), endsAt: at(101) });
      expect(first.status).toBe(201);
      const overlap = await publish(clinician.token, { startsAt: at(100.5), endsAt: at(101.5) });
      expect(overlap.status).toBe(409);
      expect(overlap.body.code).toBe('SLOT_OVERLAP');
      const same = await publish(clinician.token, { startsAt: at(100), endsAt: at(100.5) });
      expect(same.status).toBe(409);
      const adjacent = await publish(clinician.token, { startsAt: at(101), endsAt: at(102) });
      expect(adjacent.status).toBe(201);
      // a different clinician may hold the same window
      const other = await publish(otherClinician.token, { startsAt: at(100), endsAt: at(101) });
      expect(other.status).toBe(201);
    });

    it('rejects a past start (400), a bad range (400), an over-long slot (400) and date-only input (400)', async () => {
      const past = await publish(clinician.token, { startsAt: at(-3), endsAt: at(-2.5) });
      expect(past.status).toBe(400);
      expect(past.body.code).toBe('SLOT_IN_PAST');
      const range = await publish(clinician.token, { startsAt: at(120), endsAt: at(119) });
      expect(range.body.code).toBe('INVALID_SLOT_RANGE');
      const long = await publish(clinician.token, { startsAt: at(130), endsAt: at(133) });
      expect(long.body.code).toBe('SLOT_TOO_LONG');
      const dateOnly = await publish(clinician.token, { startsAt: '2030-01-01', endsAt: '2030-01-02' });
      expect(dateOnly.status).toBe(400);
      expect(dateOnly.body.code).toBe('VALIDATION_ERROR');
    });

    it('an admin cannot publish for a suspended clinician (409 CLINICIAN_NOT_ACTIVE) or a non-clinician (404)', async () => {
      const suspended = await createLoggedInUser('appt-suspended@example.com', Role.CLINICIAN);
      await ctx.prisma.user.update({
        where: { id: suspended.id },
        data: { status: UserStatus.SUSPENDED },
      });
      const res = await publish(admin.token, {
        clinicianId: suspended.id,
        startsAt: at(140),
        endsAt: at(140.5),
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLINICIAN_NOT_ACTIVE');

      const notClinician = await publish(admin.token, {
        clinicianId: parent.id,
        startsAt: at(140),
        endsAt: at(140.5),
      });
      expect(notClinician.status).toBe(404);
      expect(notClinician.body.code).toBe('CLINICIAN_NOT_FOUND');
    });
  });

  describe('GET /v1/children/{childId}/appointment-slots', () => {
    beforeAll(async () => {
      // A slot for a clinician NOT assigned to `childId` — must never be listed for it.
      await publish(unassignedClinician.token, { startsAt: at(200), endsAt: at(200.5) });
    });

    it("lists only free future slots of the child's assigned clinicians, soonest first", async () => {
      const res = await listSlots(parent.token);
      expect(res.status).toBe(200);
      const clinicianIds = new Set(res.body.data.map((s: { clinician: { id: string } }) => s.clinician.id));
      expect(clinicianIds).toEqual(new Set([clinician.id, otherClinician.id]));
      expect(clinicianIds.has(unassignedClinician.id)).toBe(false);
      const starts = res.body.data.map((s: { startsAt: string }) => s.startsAt);
      expect([...starts].sort()).toEqual(starts);
      expect(res.body.nextCursor).toBeNull();
    });

    it('omits already-started slots and slots of a suspended clinician', async () => {
      const past = await ctx.prisma.appointmentSlot.create({
        data: {
          clinicianId: clinician.id,
          startsAt: new Date(Date.now() - 2 * HOUR),
          endsAt: new Date(Date.now() - HOUR),
          createdById: admin.id,
        },
      });
      const res = await listSlots(parent.token);
      expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(past.id);

      const flaky = await createLoggedInUser('appt-flaky@example.com', Role.CLINICIAN);
      await ctx.prisma.clinicianChildAssignment.create({
        data: { clinicianId: flaky.id, childId, assignedByAdminId: admin.id },
      });
      const slot = await publish(flaky.token, { startsAt: at(210), endsAt: at(210.5) });
      expect(slot.status).toBe(201);
      await ctx.prisma.user.update({ where: { id: flaky.id }, data: { status: UserStatus.SUSPENDED } });
      const after = await listSlots(parent.token);
      expect(after.body.data.map((s: { id: string }) => s.id)).not.toContain(slot.body.id);
    });

    it('omits a booked slot', async () => {
      const slot = await publish(clinician.token, { startsAt: at(220), endsAt: at(220.5) });
      await ctx.prisma.appointment.create({
        data: { slotId: slot.body.id, childId, bookedById: parent.id },
      });
      const res = await listSlots(parent.token);
      expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(slot.body.id);
    });

    it('paginates with a cursor', async () => {
      const first = await listSlots(parent.token, childId, '?limit=2');
      expect(first.body.data).toHaveLength(2);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await listSlots(
        parent.token,
        childId,
        `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      );
      const firstIds = first.body.data.map((s: { id: string }) => s.id);
      expect(second.body.data.length).toBeGreaterThan(0);
      for (const s of second.body.data) {
        expect(firstIds).not.toContain(s.id);
      }
      expect(second.body.data[0].startsAt >= first.body.data[1].startsAt).toBe(true);
    });

    it('is visible to the assigned clinician and admin, and 403 to an unrelated parent or clinician', async () => {
      expect((await listSlots(clinician.token)).status).toBe(200);
      expect((await listSlots(admin.token)).status).toBe(200);
      expect((await listSlots(otherParent.token)).status).toBe(403);
      expect((await listSlots(unassignedClinician.token)).status).toBe(403);
    });

    it("an unrelated child's family never sees slots of clinicians assigned elsewhere", async () => {
      const res = await listSlots(otherParent.token, otherChildId);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((s: { clinician: { id: string } }) => s.clinician.id);
      expect(ids.every((id: string) => id === unassignedClinician.id)).toBe(true);
    });

    it('404s for an unknown child and 400s for a malformed id', async () => {
      expect(
        (await listSlots(admin.token, '00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
      expect((await listSlots(admin.token, 'not-a-uuid')).status).toBe(400);
    });
  });

  describe('booking and reading appointments', () => {
    let famParent: { id: string; token: string };
    let famChildId: string;
    let raceParent: { id: string; token: string };
    let raceChildId: string;
    let slotA: string;
    let slotB: string;

    const book = (token: string, id: string, slotId: string) =>
      http().post(`/v1/children/${id}/appointments`).set(auth(token)).send({ slotId });
    const listForChild = (token: string, id: string, qs = '') =>
      http().get(`/v1/children/${id}/appointments${qs}`).set(auth(token));
    const listAll = (token: string, qs = '') =>
      http().get(`/v1/appointments${qs}`).set(auth(token));
    const newSlot = async (token: string, hours: number) => {
      const res = await publish(token, { startsAt: at(hours), endsAt: at(hours + 0.5) });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    beforeAll(async () => {
      famParent = await createLoggedInUser('appt-fam-parent@example.com', Role.PARENT);
      raceParent = await createLoggedInUser('appt-race-parent@example.com', Role.PARENT);
      const fam = await ctx.prisma.child.create({
        data: { parentId: famParent.id, name: 'Fam', dateOfBirth: new Date('2019-01-01') },
      });
      const race = await ctx.prisma.child.create({
        data: { parentId: raceParent.id, name: 'Race', dateOfBirth: new Date('2019-02-02') },
      });
      famChildId = fam.id;
      raceChildId = race.id;
      await ctx.prisma.clinicianChildAssignment.createMany({
        data: [
          { clinicianId: clinician.id, childId: famChildId, assignedByAdminId: admin.id },
          { clinicianId: clinician.id, childId: raceChildId, assignedByAdminId: admin.id },
        ],
      });
      slotA = await newSlot(clinician.token, 300);
      slotB = await newSlot(clinician.token, 310);
    });

    it('a parent books an assigned clinician slot: 201 with the clinician name; the slot leaves the free list', async () => {
      const res = await book(famParent.token, famChildId, slotA);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        childId: famChildId,
        slotId: slotA,
        clinician: { id: clinician.id, name: expect.any(String) },
        startsAt: at(300),
      });
      const free = await listSlots(famParent.token, famChildId);
      const ids = free.body.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(slotA);
      expect(ids).toContain(slotB);
    });

    it('a second upcoming appointment for the same child is 409 APPOINTMENT_ALREADY_UPCOMING', async () => {
      const res = await book(famParent.token, famChildId, slotB);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPOINTMENT_ALREADY_UPCOMING');
    });

    it('concurrent bookings of one slot: exactly one 201 and one 409, one row', async () => {
      const slot = await newSlot(clinician.token, 320);
      const results = await Promise.all([
        book(raceParent.token, raceChildId, slot),
        book(raceParent.token, raceChildId, slot),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(loser?.body.code).toBe('SLOT_ALREADY_BOOKED');
      expect(await ctx.prisma.appointment.count({ where: { slotId: slot } })).toBe(1);
    });

    it('a slot already booked by another family is 409 SLOT_ALREADY_BOOKED (unique slotId guard)', async () => {
      await ctx.prisma.clinicianChildAssignment.create({
        data: { clinicianId: clinician.id, childId: otherChildId, assignedByAdminId: admin.id },
      });
      const res = await book(otherParent.token, otherChildId, slotA);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SLOT_ALREADY_BOOKED');
    });

    it('a slot of a clinician not assigned to the child is 404 SLOT_NOT_FOUND (existence not disclosed)', async () => {
      const foreign = await newSlot(unassignedClinician.token, 330);
      const res = await book(famParent.token, famChildId, foreign);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SLOT_NOT_FOUND');
      const missing = await book(famParent.token, famChildId, '00000000-0000-4000-8000-000000000000');
      expect(missing.body.code).toBe('SLOT_NOT_FOUND');
    });

    it('a past slot is 404 SLOT_NOT_FOUND', async () => {
      const past = await ctx.prisma.appointmentSlot.create({
        data: {
          clinicianId: clinician.id,
          startsAt: new Date(Date.now() - 5 * HOUR),
          endsAt: new Date(Date.now() - 4 * HOUR),
          createdById: admin.id,
        },
      });
      const res = await book(raceParent.token, raceChildId, past.id);
      expect(res.status).toBe(404);
    });

    it('another parent, a clinician and an admin cannot book for this child (403); bad body is 400', async () => {
      const slot = await newSlot(clinician.token, 340);
      expect((await book(otherParent.token, famChildId, slot)).status).toBe(403);
      expect((await book(clinician.token, famChildId, slot)).status).toBe(403);
      expect((await book(admin.token, famChildId, slot)).status).toBe(403);
      const bad = await http()
        .post(`/v1/children/${famChildId}/appointments`)
        .set(auth(famParent.token))
        .send({ slotId: 'nope' });
      expect(bad.status).toBe(400);
      const unknownChild = await book(famParent.token, '00000000-0000-4000-8000-000000000000', slot);
      expect(unknownChild.status).toBe(404);
    });

    it('the parent reads the booking with the clinician name; unrelated callers are 403', async () => {
      const res = await listForChild(famParent.token, famChildId);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ slotId: slotA, clinician: { id: clinician.id } });
      expect(Object.keys(res.body.data[0].clinician).sort()).toEqual(['id', 'name']);
      expect((await listForChild(otherParent.token, famChildId)).status).toBe(403);
      expect((await listForChild(unassignedClinician.token, famChildId)).status).toBe(403);
      expect((await listForChild(clinician.token, famChildId)).status).toBe(200);
      expect((await listForChild(admin.token, famChildId)).status).toBe(200);
    });

    it('GET /v1/appointments: a clinician sees only their own booked calls, another none, admin all', async () => {
      const mine = await listAll(clinician.token);
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((a: { slotId: string }) => a.slotId)).toContain(slotA);
      expect(
        mine.body.data.every((a: { clinician: { id: string } }) => a.clinician.id === clinician.id),
      ).toBe(true);

      const none = await listAll(otherClinician.token);
      expect(none.body.data).toEqual([]);

      const all = await listAll(admin.token);
      expect(all.body.data.length).toBeGreaterThanOrEqual(mine.body.data.length);

      const parentView = await listAll(famParent.token);
      expect(parentView.body.data.map((a: { childId: string }) => a.childId)).toEqual([famChildId]);
    });

    it('?when=upcoming|past splits on slot end; an invalid value is 400', async () => {
      const pastSlot = await ctx.prisma.appointmentSlot.create({
        data: {
          clinicianId: clinician.id,
          startsAt: new Date(Date.now() - 48 * HOUR),
          endsAt: new Date(Date.now() - 47 * HOUR),
          createdById: admin.id,
        },
      });
      await ctx.prisma.appointment.create({
        data: { slotId: pastSlot.id, childId: famChildId, bookedById: famParent.id },
      });
      const upcoming = await listForChild(famParent.token, famChildId, '?when=upcoming');
      expect(upcoming.body.data.map((a: { slotId: string }) => a.slotId)).toEqual([slotA]);
      const past = await listForChild(famParent.token, famChildId, '?when=past');
      expect(past.body.data.map((a: { slotId: string }) => a.slotId)).toEqual([pastSlot.id]);
      const everything = await listForChild(famParent.token, famChildId);
      expect(everything.body.data).toHaveLength(2);
      const pastClin = await listAll(clinician.token, '?when=past');
      expect(pastClin.body.data.map((a: { slotId: string }) => a.slotId)).toContain(pastSlot.id);
      expect((await listAll(admin.token, '?when=soon')).status).toBe(400);
    });
  });
});

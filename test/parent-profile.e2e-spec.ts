import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Parent profile updates (e2e)', () => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let parent: { id: string; token: string };
  let otherParent: { id: string; token: string };
  let clinician: { id: string; token: string };
  let strangerClinician: { id: string; token: string };
  let admin: { id: string; token: string };
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, otherParent, clinician, strangerClinician, admin] = await Promise.all([
      createLoggedInUser('pp-parent@example.com', Role.PARENT),
      createLoggedInUser('pp-other@example.com', Role.PARENT),
      createLoggedInUser('pp-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('pp-stranger@example.com', Role.CLINICIAN),
      createLoggedInUser('pp-admin@example.com', Role.ADMIN),
    ]);
    const child = await ctx.prisma.child.create({
      data: { parentId: parent.id, name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    childId = child.id;
    await ctx.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: admin.id },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('PATCH /v1/users/me', () => {
    it('updates the display name', async () => {
      const res = await http()
        .patch('/v1/users/me')
        .set(auth(parent.token))
        .send({ name: '  Priya S ' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Priya S');
      const me = await http().get('/v1/users/me').set(auth(parent.token));
      expect(me.body.name).toBe('Priya S');
    });

    it('rejects an empty name and unknown fields', async () => {
      expect(
        (await http().patch('/v1/users/me').set(auth(parent.token)).send({ name: '' })).status,
      ).toBe(400);
      expect(
        (
          await http()
            .patch('/v1/users/me')
            .set(auth(parent.token))
            .send({ name: 'X', email: 'a@b.co' })
        ).status,
      ).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await http().patch('/v1/users/me').send({ name: 'X' })).status).toBe(401);
    });
  });

  describe('PATCH /v1/children/{id}', () => {
    it('lets the parent edit profile fields and clear one with an empty string', async () => {
      const res = await http()
        .patch(`/v1/children/${childId}`)
        .set(auth(parent.token))
        .send({
          preferredName: 'Lex',
          gender: 'Male',
          primaryLanguage: 'English',
          accommodations: 'Dim lights',
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        preferredName: 'Lex',
        gender: 'Male',
        primaryLanguage: 'English',
        accommodations: 'Dim lights',
        clinicalProfile: null,
      });

      const cleared = await http()
        .patch(`/v1/children/${childId}`)
        .set(auth(parent.token))
        .send({ accommodations: '' });
      expect(cleared.body.accommodations).toBeNull();
      expect(cleared.body.preferredName).toBe('Lex');
    });

    it('rejects an empty patch and a future date of birth', async () => {
      expect(
        (await http().patch(`/v1/children/${childId}`).set(auth(parent.token)).send({})).status,
      ).toBe(400);
      expect(
        (
          await http()
            .patch(`/v1/children/${childId}`)
            .set(auth(parent.token))
            .send({ dateOfBirth: '2999-01-01' })
        ).status,
      ).toBe(400);
    });

    it('is forbidden for another parent, a clinician and an admin; 404 for an unknown child', async () => {
      for (const who of [otherParent, clinician, admin]) {
        const res = await http()
          .patch(`/v1/children/${childId}`)
          .set(auth(who.token))
          .send({ name: 'Zed' });
        expect([403]).toContain(res.status);
      }
      const missing = await http()
        .patch('/v1/children/11111111-1111-1111-1111-111111111111')
        .set(auth(parent.token))
        .send({ name: 'Zed' });
      expect(missing.status).toBe(404);
    });
  });

  describe('PUT /v1/children/{id}/clinical-profile', () => {
    const profile = {
      currentStage: 'Emerging',
      primaryCareFocus: 'Three-word requests',
      strengths: [{ title: 'Pattern play', description: 'Loves puzzles', icon: 'puzzle' }],
      sensoryTraits: [
        {
          domain: 'Auditory',
          sensitivityLevel: 'HIGH',
          triggers: ['Hand dryer'],
          accommodations: ['Headphones'],
        },
      ],
      calmingPreferences: [{ title: 'Deep pressure', technique: 'Weighted blanket' }],
      communication: {
        expressiveMode: 'Single words',
        receptiveUnderstanding: 'Good',
        preferredPrompts: ['Show me'],
      },
    };

    it('lets an assigned clinician set it and the parent read it back', async () => {
      const res = await http()
        .put(`/v1/children/${childId}/clinical-profile`)
        .set(auth(clinician.token))
        .send(profile);
      expect(res.status).toBe(200);
      expect(res.body.clinicalProfile.strengths[0].title).toBe('Pattern play');

      const read = await http().get(`/v1/children/${childId}`).set(auth(parent.token));
      expect(read.body.clinicalProfile.sensoryTraits[0].sensitivityLevel).toBe('HIGH');
    });

    it('lets an admin set it but not the parent or an unassigned clinician', async () => {
      expect(
        (
          await http()
            .put(`/v1/children/${childId}/clinical-profile`)
            .set(auth(admin.token))
            .send(profile)
        ).status,
      ).toBe(200);
      expect(
        (
          await http()
            .put(`/v1/children/${childId}/clinical-profile`)
            .set(auth(parent.token))
            .send(profile)
        ).status,
      ).toBe(403);
      expect(
        (
          await http()
            .put(`/v1/children/${childId}/clinical-profile`)
            .set(auth(strangerClinician.token))
            .send(profile)
        ).status,
      ).toBe(403);
    });

    it('validates the sensitivity level and array sizes', async () => {
      const bad = {
        ...profile,
        sensoryTraits: [
          { domain: 'Auditory', sensitivityLevel: 'EXTREME', triggers: [], accommodations: [] },
        ],
      };
      expect(
        (
          await http()
            .put(`/v1/children/${childId}/clinical-profile`)
            .set(auth(clinician.token))
            .send(bad)
        ).status,
      ).toBe(400);
    });
  });
});

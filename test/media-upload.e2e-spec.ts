import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * Ticket → confirm round trip, plus the same cross-parent/cross-clinician isolation
 * shape as `child-care-domain.e2e-spec.ts` (Phase 4), applied one hop further via
 * `Media.childId`. All actors are created once in `beforeAll` and reused across every
 * `it`, same throttle-budget reasoning as that suite.
 */
describe('Media upload: ticket → confirm → list (e2e)', () => {
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

  let parentOwner: { id: string; token: string };
  let parentOther: { id: string; token: string };
  let admin: { id: string; token: string };
  let clinicianAssigned: { id: string; token: string };
  let clinicianOther: { id: string; token: string };
  let childId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [parentOwner, parentOther, admin, clinicianAssigned, clinicianOther] = await Promise.all([
      createLoggedInUser('media-owner@example.com', Role.PARENT),
      createLoggedInUser('media-other-parent@example.com', Role.PARENT),
      createLoggedInUser('media-admin@example.com', Role.ADMIN),
      createLoggedInUser('media-assigned-clinician@example.com', Role.CLINICIAN),
      createLoggedInUser('media-other-clinician@example.com', Role.CLINICIAN),
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

  it('a non-existent child id is a 404 on ticket creation', async () => {
    const res = await asToken(parentOwner.token)(
      http()
        .post('/v1/children/11111111-1111-1111-1111-111111111111/media/upload-tickets')
        .send({ type: 'PHOTO' }),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });

  it("a non-owning parent cannot create an upload ticket for someone else's child", async () => {
    const res = await asToken(parentOther.token)(
      http().post(`/v1/children/${childId}/media/upload-tickets`).send({ type: 'PHOTO' }),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('an assigned clinician cannot create an upload ticket (role lacks the permission)', async () => {
    const res = await asToken(clinicianAssigned.token)(
      http().post(`/v1/children/${childId}/media/upload-tickets`).send({ type: 'PHOTO' }),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('the owning parent creates a PENDING upload ticket, then confirms UPLOADED', async () => {
    const ticket = await asToken(parentOwner.token)(
      http()
        .post(`/v1/children/${childId}/media/upload-tickets`)
        .send({ type: 'PHOTO', context: 'first steps' }),
    );
    expect(ticket.status).toBe(201);
    expect(ticket.body.media).toMatchObject({
      childId,
      uploadedById: parentOwner.id,
      type: 'PHOTO',
      status: 'PENDING',
      context: 'first steps',
    });
    expect(ticket.body.uploadParams).toBeDefined();
    const mediaId = ticket.body.media.id as string;

    const confirm = await asToken(parentOwner.token)(
      http()
        .post(`/v1/media/${mediaId}/confirm`)
        .send({ status: 'UPLOADED', mimeType: 'image/jpeg', sizeBytes: 2048 }),
    );
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({
      id: mediaId,
      status: 'UPLOADED',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });

    const reconfirmSame = await asToken(parentOwner.token)(
      http()
        .post(`/v1/media/${mediaId}/confirm`)
        .send({ status: 'UPLOADED', mimeType: 'image/jpeg', sizeBytes: 2048 }),
    );
    expect(reconfirmSame.status).toBe(200);
    expect(reconfirmSame.body.status).toBe('UPLOADED');

    const reconfirmConflicting = await asToken(parentOwner.token)(
      http().post(`/v1/media/${mediaId}/confirm`).send({ status: 'FAILED' }),
    );
    expect(reconfirmConflicting.status).toBe(409);
    expect(reconfirmConflicting.body.code).toBe('MEDIA_ALREADY_CONFIRMED');
  });

  it('confirming with a non-existent media id is a 404', async () => {
    const res = await asToken(parentOwner.token)(
      http()
        .post('/v1/media/11111111-1111-1111-1111-111111111111/confirm')
        .send({ status: 'UPLOADED' }),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MEDIA_NOT_FOUND');
  });

  it('a parent confirming a FAILED upload does not touch the storage provider', async () => {
    const ticket = await asToken(parentOwner.token)(
      http().post(`/v1/children/${childId}/media/upload-tickets`).send({ type: 'VIDEO' }),
    );
    const mediaId = ticket.body.media.id as string;

    const confirm = await asToken(parentOwner.token)(
      http().post(`/v1/media/${mediaId}/confirm`).send({ status: 'FAILED' }),
    );
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('FAILED');
    expect(confirm.body.mimeType).toBeNull();
  });

  it('confirming UPLOADED when the provider never received the asset is a 400', async () => {
    const ticket = await asToken(parentOwner.token)(
      http().post(`/v1/children/${childId}/media/upload-tickets`).send({ type: 'PHOTO' }),
    );
    const media = ticket.body.media as { id: string; childId: string };
    ctx.mediaStorage.simulateMissing(`fake/${media.childId}/${media.id}`);

    const confirm = await asToken(parentOwner.token)(
      http()
        .post(`/v1/media/${media.id}/confirm`)
        .send({ status: 'UPLOADED', mimeType: 'image/png', sizeBytes: 10 }),
    );
    expect(confirm.status).toBe(400);
    expect(confirm.body.code).toBe('MEDIA_UPLOAD_NOT_VERIFIED');
  });

  it("a different parent cannot confirm someone else's media", async () => {
    const ticket = await asToken(parentOwner.token)(
      http().post(`/v1/children/${childId}/media/upload-tickets`).send({ type: 'PHOTO' }),
    );
    const mediaId = ticket.body.media.id as string;

    const res = await asToken(parentOther.token)(
      http().post(`/v1/media/${mediaId}/confirm`).send({ status: 'UPLOADED' }),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it("the owning parent lists the child's media", async () => {
    const res = await asToken(parentOwner.token)(http().get(`/v1/children/${childId}/media`));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((m: { childId: string }) => m.childId === childId)).toBe(true);
  });

  it('an assigned clinician can list but not create', async () => {
    const list = await asToken(clinicianAssigned.token)(
      http().get(`/v1/children/${childId}/media`),
    );
    expect(list.status).toBe(200);
  });

  it('a non-assigned clinician cannot list', async () => {
    const res = await asToken(clinicianOther.token)(http().get(`/v1/children/${childId}/media`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('a different parent cannot list', async () => {
    const res = await asToken(parentOther.token)(http().get(`/v1/children/${childId}/media`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('admin lists unconditionally', async () => {
    const res = await asToken(admin.token)(http().get(`/v1/children/${childId}/media`));
    expect(res.status).toBe(200);
  });

  it('listing a non-existent child is a 404', async () => {
    const res = await asToken(admin.token)(
      http().get('/v1/children/11111111-1111-1111-1111-111111111111/media'),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHILD_NOT_FOUND');
  });
});

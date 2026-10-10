import request from 'supertest';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Push devices (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const password = 'a-strong-passphrase';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const token = 'fcm-token-aaaaaaaaaaaaaaaaaaaa';

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

  let parent: { id: string; token: string };
  let clinician: { id: string; token: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    [parent, clinician] = await Promise.all([
      createLoggedInUser('dev-parent@example.com', Role.PARENT),
      createLoggedInUser('dev-clinician@example.com', Role.CLINICIAN),
    ]);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('needs a signed-in user', async () => {
    expect((await http().post('/v1/devices').send({ token })).status).toBe(401);
    expect((await http().post('/v1/devices/unregister').send({ token })).status).toBe(401);
  });

  it('validates the token and platform', async () => {
    const send = (body: object) => http().post('/v1/devices').set(auth(parent.token)).send(body);
    expect((await send({})).status).toBe(400);
    expect((await send({ token: 'short' })).status).toBe(400);
    expect((await send({ token, platform: 'windows' })).status).toBe(400);
  });

  it('registers a phone for a parent and for a clinician, and repeating it is harmless', async () => {
    for (const who of [parent, clinician]) {
      const res = await http()
        .post('/v1/devices')
        .set(auth(who.token))
        .send({ token: `${token}-${who.id}` });
      expect(res.status).toBe(204);
    }
    await http()
      .post('/v1/devices')
      .set(auth(parent.token))
      .send({ token: `${token}-${parent.id}` });
    expect(await ctx.prisma.deviceToken.count()).toBe(2);
    expect(
      await ctx.prisma.deviceToken.findUnique({ where: { token: `${token}-${parent.id}` } }),
    ).toMatchObject({ userId: parent.id, platform: 'android' });
  });

  it('moves a token to whoever signs in on the phone next', async () => {
    await http().post('/v1/devices').set(auth(parent.token)).send({ token });
    await http().post('/v1/devices').set(auth(clinician.token)).send({ token });
    const rows = await ctx.prisma.deviceToken.findMany({ where: { token } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(clinician.id);
  });

  it("unregisters only the caller's own token", async () => {
    const stranger = await http()
      .post('/v1/devices/unregister')
      .set(auth(parent.token))
      .send({ token });
    expect(stranger.status).toBe(204);
    expect(await ctx.prisma.deviceToken.count({ where: { token } })).toBe(1);

    const own = await http()
      .post('/v1/devices/unregister')
      .set(auth(clinician.token))
      .send({ token });
    expect(own.status).toBe(204);
    expect(await ctx.prisma.deviceToken.count({ where: { token } })).toBe(0);
  });
});

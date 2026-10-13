import { Logger } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ImpersonateUserService } from './impersonate-user.service';

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: Role.ADMIN,
  status: UserStatus.ACTIVE,
};
const parentRow = {
  id: 'parent-1',
  email: 'parent@example.com',
  name: 'Meera Rao',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};

function make(opts: { enabled?: boolean; ttlMin?: number } = {}) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(parentRow) } };
  const tokens = {
    issue: jest.fn().mockResolvedValue({ accessToken: 'signed.token', expiresIn: 3600 }),
  };
  const config = {
    get: () => ({ enabled: opts.enabled ?? true, ttlMin: opts.ttlMin ?? 60 }),
  };
  const service = new ImpersonateUserService(prisma as never, tokens as never, config as never);
  return { service, prisma, tokens };
}

describe('ImpersonateUserService', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('mints a short-lived token for an active parent that names the admin, and logs ids only', async () => {
    const h = make({ ttlMin: 30 });

    const res = await h.service.impersonate('parent-1', admin);

    expect(h.tokens.issue).toHaveBeenCalledWith(parentRow, {
      impersonatedBy: 'admin-1',
      ttl: '30m',
    });
    expect(res).toEqual({
      accessToken: 'signed.token',
      expiresIn: 3600,
      user: {
        id: 'parent-1',
        name: 'Meera Rao',
        email: 'parent@example.com',
        role: Role.PARENT,
      },
      impersonatedBy: 'admin-1',
    });
    expect(warn).toHaveBeenCalledWith(
      { adminId: 'admin-1', targetUserId: 'parent-1', ttlMin: 30 },
      'impersonation token issued',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('signed.token');
  });

  it('is a 404 IMPERSONATION_DISABLED, touching nothing, unless the flag is on', async () => {
    const h = make({ enabled: false });

    await expect(h.service.impersonate('parent-1', admin)).rejects.toMatchObject({
      status: 404,
      response: { code: 'IMPERSONATION_DISABLED' },
    });
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(h.tokens.issue).not.toHaveBeenCalled();
  });

  it.each([Role.ADMIN, Role.CLINICIAN, Role.EXPERT])('refuses to impersonate a %s', async (role) => {
    const h = make();
    h.prisma.user.findUnique.mockResolvedValue({ ...parentRow, role });

    await expect(h.service.impersonate('x', admin)).rejects.toMatchObject({
      status: 422,
      response: { code: 'IMPERSONATION_TARGET_NOT_ALLOWED' },
    });
    expect(h.tokens.issue).not.toHaveBeenCalled();
  });

  it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED, UserStatus.INVITED])(
    'refuses a %s parent with 409',
    async (status) => {
      const h = make();
      h.prisma.user.findUnique.mockResolvedValue({ ...parentRow, status });

      await expect(h.service.impersonate('parent-1', admin)).rejects.toMatchObject({
        status: 409,
        response: { code: 'ACCOUNT_NOT_ACTIVE' },
      });
    },
  );

  it('404s an unknown user', async () => {
    const h = make();
    h.prisma.user.findUnique.mockResolvedValue(null);
    await expect(h.service.impersonate('nobody', admin)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a caller who is not an admin, or who is itself an impersonated session', async () => {
    const h = make();
    await expect(
      h.service.impersonate('parent-1', { ...admin, role: Role.PARENT }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.service.impersonate('parent-1', { ...admin, impersonatedBy: 'someone' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.tokens.issue).not.toHaveBeenCalled();
  });

  it('warns at boot only when switched on', () => {
    make({ enabled: true }).service.onModuleInit();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    make({ enabled: false }).service.onModuleInit();
    expect(warn).not.toHaveBeenCalled();
  });
});

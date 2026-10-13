import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { REQUIRED_PERMISSIONS_KEY } from './auth.decorator';
import { AccessTokenService } from './access-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './jwt-payload.type';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS, roleHasPermission, type Permission } from './permissions';

interface Row {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
}

const SECRET = 'a-long-test-secret-for-the-guards-0123456789';
const jwt = new JwtService({});

function tokenService(ttl = '15m') {
  const config = { get: () => ({ accessSecret: SECRET, accessTtl: ttl, refreshTtlDays: 30 }) };
  return new AccessTokenService(jwt, config as never);
}

function jwtGuard(opts: {
  enabled: boolean;
  rows: Record<string, Row>;
}) {
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => opts.rows[where.id] ?? null),
    },
  };
  const config = {
    get: (key: string) =>
      key === 'jwt'
        ? { accessSecret: SECRET }
        : { enabled: opts.enabled, ttlMin: 60 },
  };
  const guard = new JwtAuthGuard(new Reflector(), jwt, prisma as never, config as never);
  const run = async (token: string) => {
    const request: { headers: { authorization: string }; user?: AuthenticatedUser } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return request.user!;
  };
  return { run };
}

const adminRow: Row = { id: 'admin-1', email: 'a@example.com', role: Role.ADMIN, status: UserStatus.ACTIVE };
const parentRow: Row = { id: 'parent-1', email: 'p@example.com', role: Role.PARENT, status: UserStatus.ACTIVE };

describe('impersonation tokens in JwtAuthGuard', () => {
  it('a normal token carries no impersonation marker', async () => {
    const { accessToken } = await tokenService().issue(parentRow);
    const user = await jwtGuard({ enabled: true, rows: { 'parent-1': parentRow } }).run(accessToken);
    expect(user).toEqual(parentRow);
    expect(user.impersonatedBy).toBeUndefined();
  });

  it('acts as the parent and names the admin, with the shorter lifetime asked for', async () => {
    const tokens = tokenService();
    const issued = await tokens.issue(parentRow, { impersonatedBy: 'admin-1', ttl: '30m' });
    expect(issued.expiresIn).toBe(1800);

    const user = await jwtGuard({
      enabled: true,
      rows: { 'parent-1': parentRow, 'admin-1': adminRow },
    }).run(issued.accessToken);

    expect(user).toMatchObject({ id: 'parent-1', role: Role.PARENT, impersonatedBy: 'admin-1' });
  });

  it.each([
    ['the feature is switched off', { enabled: false, admin: adminRow }],
    ['the admin was deactivated', { enabled: true, admin: { ...adminRow, status: UserStatus.DEACTIVATED } }],
    ['the admin was demoted', { enabled: true, admin: { ...adminRow, role: Role.PARENT } }],
    ['the admin no longer exists', { enabled: true, admin: undefined }],
  ])('is an invalid token once %s', async (_name, { enabled, admin }) => {
    const { accessToken } = await tokenService().issue(parentRow, { impersonatedBy: 'admin-1' });
    const rows: Record<string, Row> = { 'parent-1': parentRow };
    if (admin) rows['admin-1'] = admin;

    await expect(jwtGuard({ enabled, rows }).run(accessToken)).rejects.toMatchObject({
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('never lets an impersonation token act as anyone but a parent', async () => {
    const expert = { ...parentRow, id: 'expert-1', role: Role.EXPERT };
    const { accessToken } = await tokenService().issue(expert, { impersonatedBy: 'admin-1' });

    await expect(
      jwtGuard({ enabled: true, rows: { 'expert-1': expert, 'admin-1': adminRow } }).run(accessToken),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TOKEN' } });
  });
});

describe('PermissionsGuard while impersonating', () => {
  const run = (user: AuthenticatedUser, permission: Permission) => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
      key === REQUIRED_PERMISSIONS_KEY ? [permission] : false,
    );
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return () => guard.canActivate(context);
  };
  const acting: AuthenticatedUser = { ...parentRow, impersonatedBy: 'admin-1' };

  it.each(['user:change-password:self', 'user:deactivate:self'] as const)(
    'refuses %s with IMPERSONATION_RESTRICTED, though a parent holds it',
    (permission) => {
      expect(roleHasPermission(Role.PARENT, permission)).toBe(true);
      expect(run(parentRow, permission)()).toBe(true);
      expect(run(acting, permission)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'IMPERSONATION_RESTRICTED' }) }),
      );
    },
  );

  it('allows everything else a parent may do', () => {
    expect(run(acting, 'ai-chat:send:self')()).toBe(true);
    expect(run(acting, 'message:send')()).toBe(true);
  });

  it('only an admin holds user:impersonate', () => {
    expect(PERMISSIONS).toContain('user:impersonate');
    for (const role of [Role.PARENT, Role.EXPERT, Role.CLINICIAN]) {
      expect(roleHasPermission(role, 'user:impersonate')).toBe(false);
    }
    expect(roleHasPermission(Role.ADMIN, 'user:impersonate')).toBe(true);
  });
});

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from './auth.decorator';
import type { AuthenticatedUser } from './jwt-payload.type';
import { type Permission, roleHasPermission } from './permissions';

/**
 * Authorization guard. Runs after {@link JwtAuthGuard} and checks the route's
 * `@RequirePermissions(...)` against the caller's role via the static ROLE_PERMISSIONS map.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // JwtAuthGuard should have populated this; defensive only.
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not authenticated.' });
    }

    const missing = required.filter((perm) => !roleHasPermission(user.role, perm));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `Missing required permission(s): ${missing.join(', ')}`,
      });
    }
    return true;
  }
}

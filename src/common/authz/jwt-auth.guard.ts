import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '@prisma/client';
import type { Request } from 'express';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import type { AuthenticatedUser, JwtPayload } from './jwt-payload.type';

/**
 * Authentication guard. Verifies the bearer access token, re-checks the account's
 * live status in the database — so a DEACTIVATED / SUSPENDED user is cut off
 * immediately rather than only once their access token expires — and populates
 * `request.user` from the current DB row. Registered globally; `@Public()` skips it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly accessSecret: string;
  private readonly impersonationEnabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.accessSecret = config.get('jwt', { infer: true }).accessSecret;
    this.impersonationEnabled = config.get('impersonation', { infer: true }).enabled;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException({
        code: 'MISSING_TOKEN',
        message: 'Authorization bearer token is required.',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Access token is invalid or expired.',
      });
    }

    // The token is authentic; now confirm the account is still usable. Reading the
    // row here (indexed PK lookup) means status/role changes take effect on the very
    // next request instead of lagging until the access token expires.
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!account) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Access token is invalid or expired.',
      });
    }

    if (account.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'This account is not active.',
      });
    }

    const user: AuthenticatedUser = {
      id: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
      ...(payload.imp ? { impersonatedBy: await this.verifyImpersonator(payload.imp, account.role) } : {}),
    };
    (request as Request & { user: AuthenticatedUser }).user = user;
    return true;
  }

  /**
   * An impersonation token (claim `imp`) is honoured only while the feature is switched on, for a PARENT
   * target, and while the admin who minted it is still an active ADMIN. Anything else reads as an
   * invalid token, so turning the flag off or deactivating the admin ends every such session at once.
   */
  private async verifyImpersonator(adminId: string, targetRole: Role): Promise<string> {
    const admin = this.impersonationEnabled
      ? await this.prisma.user.findUnique({
          where: { id: adminId },
          select: { role: true, status: true },
        })
      : null;
    if (
      !admin ||
      admin.role !== Role.ADMIN ||
      admin.status !== UserStatus.ACTIVE ||
      targetRole !== Role.PARENT
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Access token is invalid or expired.',
      });
    }
    return adminId;
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}

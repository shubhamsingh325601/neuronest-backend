import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '@prisma/client';
import { AccessTokenService } from '@common/authz/access-token.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { ImpersonationResponseDto } from './dto/impersonation.response.dto';

/**
 * TEMPORARY testing aid. An ADMIN gets a short-lived access token that acts as a PARENT, so the parent
 * features (AI chat, expert chat, ...) can be tried from the admin site without a mobile app. Remove
 * this feature before real families use the app.
 *
 * Safeguards: off unless `IMPERSONATION_ENABLED=true` (404 otherwise, and existing tokens stop working);
 * PARENT accounts only; the token has an `imp` claim naming the admin, a fixed short lifetime and no
 * refresh token; the guard re-checks that the admin is still an active ADMIN on every request; an
 * impersonated session cannot change the password or deactivate the account; every token issued is logged
 * (admin and target ids only).
 */
@Injectable()
export class ImpersonateUserService implements OnModuleInit {
  private readonly logger = new Logger(ImpersonateUserService.name);
  private readonly enabled: boolean;
  private readonly ttlMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
    config: ConfigService<AppConfig, true>,
  ) {
    const impersonation = config.get('impersonation', { infer: true });
    this.enabled = impersonation.enabled;
    this.ttlMin = impersonation.ttlMin;
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.logger.warn(
        'IMPERSONATION_ENABLED is on: admins can act as any parent. This is a temporary testing aid; ' +
          'turn it off before real families use the app.',
      );
    }
  }

  async impersonate(targetId: string, admin: AuthenticatedUser): Promise<ImpersonationResponseDto> {
    if (!this.enabled) {
      throw new NotFoundException({
        code: 'IMPERSONATION_DISABLED',
        message: 'Impersonation is not enabled on this deployment.',
      });
    }
    // The permission already limits this to ADMIN; an impersonated session can never be one.
    if (admin.role !== Role.ADMIN || admin.impersonatedBy) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    if (!target) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No user with that id.' });
    }
    if (target.role !== Role.PARENT) {
      throw new UnprocessableEntityException({
        code: 'IMPERSONATION_TARGET_NOT_ALLOWED',
        message: 'Only a parent account can be impersonated.',
      });
    }
    if (target.status !== UserStatus.ACTIVE) {
      throw new ConflictException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'This account is not active.',
      });
    }

    const { accessToken, expiresIn } = await this.tokens.issue(target, {
      impersonatedBy: admin.id,
      ttl: `${this.ttlMin}m`,
    });
    this.logger.warn(
      { adminId: admin.id, targetUserId: target.id, ttlMin: this.ttlMin },
      'impersonation token issued',
    );
    return {
      accessToken,
      expiresIn,
      user: { id: target.id, name: target.name, email: target.email, role: target.role },
      impersonatedBy: admin.id,
    };
  }
}

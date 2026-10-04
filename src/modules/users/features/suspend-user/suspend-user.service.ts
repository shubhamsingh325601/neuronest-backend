import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { UserStatusResponseDto } from '@modules/users/shared/user-status.dto';

/**
 * Admin suspends a user (§3 row 6 of plan 0008). Valid from `ACTIVE`/`INVITED`;
 * repeating on an already-`SUSPENDED` user is idempotent (`200` + current state, not
 * an error). Self-suspend is blocked (`409 CANNOT_SUSPEND_SELF`) to prevent lockout —
 * checked before the row is even loaded. Revokes every refresh token, same call
 * `DeactivateService` already makes, so the suspension takes effect immediately
 * instead of lagging until the access token expires. Also consumes outstanding
 * account-setup links so a suspended invitee cannot activate themselves with an old one.
 */
@Injectable()
export class SuspendUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly verificationTokens: VerificationTokenService,
  ) {}

  async suspend(id: string, callerId: string): Promise<UserStatusResponseDto> {
    if (id === callerId) {
      throw new ConflictException({
        code: 'CANNOT_SUSPEND_SELF',
        message: 'You cannot suspend your own account.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, updatedAt: true },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No user with that id.' });
    }

    if (user.status === UserStatus.SUSPENDED) {
      return user;
    }
    if (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.INVITED) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'This account cannot be suspended from its current status.',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.SUSPENDED },
      select: { id: true, status: true, updatedAt: true },
    });
    await this.refreshTokens.revokeAllForUser(id);
    await this.verificationTokens.revokeAccountSetup(id);
    return updated;
  }
}

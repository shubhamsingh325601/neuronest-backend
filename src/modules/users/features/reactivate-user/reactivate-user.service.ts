import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserStatusResponseDto } from '@modules/users/shared/user-status.dto';

/**
 * Admin reactivates a user (§3 row 6 of plan 0008). Valid from `SUSPENDED` or
 * `DEACTIVATED` — the latter means admin-reactivate can reverse a self-deactivation
 * too, per `deactivate.service.ts`'s own doc comment anticipating this. Repeating on
 * an already-`ACTIVE` user is idempotent (`200` + current state). A user with no
 * password is restored to `INVITED`, not `ACTIVE` (plan 0010 X-2). No token revocation
 * here — reactivating grants access back, it doesn't need to end sessions.
 */
@Injectable()
export class ReactivateUserService {
  constructor(private readonly prisma: PrismaService) {}

  async reactivate(id: string): Promise<UserStatusResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, passwordHash: true, updatedAt: true },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No user with that id.' });
    }

    if (user.status === UserStatus.ACTIVE) {
      return { id: user.id, status: user.status, updatedAt: user.updatedAt };
    }
    if (user.status !== UserStatus.SUSPENDED && user.status !== UserStatus.DEACTIVATED) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'This account cannot be reactivated from its current status.',
      });
    }

    return this.prisma.user.update({
      where: { id },
      // A user who never set a password (suspended while INVITED) cannot be ACTIVE —
      // they could never log in. Restore INVITED; the admin then resends the invitation.
      data: { status: user.passwordHash === null ? UserStatus.INVITED : UserStatus.ACTIVE },
      select: { id: true, status: true, updatedAt: true },
    });
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserStatusResponseDto } from '@modules/users/shared/user-status.dto';

/**
 * Admin reactivates a user (§3 row 6 of plan 0008). Valid from `SUSPENDED` or
 * `DEACTIVATED` — the latter means admin-reactivate can reverse a self-deactivation
 * too, per `deactivate.service.ts`'s own doc comment anticipating this. Repeating on
 * an already-`ACTIVE` user is idempotent (`200` + current state). No token revocation
 * here — reactivating grants access back, it doesn't need to end sessions.
 */
@Injectable()
export class ReactivateUserService {
  constructor(private readonly prisma: PrismaService) {}

  async reactivate(id: string): Promise<UserStatusResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, updatedAt: true },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No user with that id.' });
    }

    if (user.status === UserStatus.ACTIVE) {
      return user;
    }
    if (user.status !== UserStatus.SUSPENDED && user.status !== UserStatus.DEACTIVATED) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'This account cannot be reactivated from its current status.',
      });
    }

    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
      select: { id: true, status: true, updatedAt: true },
    });
  }
}

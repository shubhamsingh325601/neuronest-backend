import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { ChangePasswordDto, ChangePasswordResponseDto } from './dto/change-password.dto';

/**
 * Authenticated change-password (B4, plan 0008). Lives in the `auth` module, not
 * `users` (§3 row 13) — reuses `reset-password.service.ts`'s exact pattern: verify the
 * current password, hash+persist the new one, then `refreshTokens.revokeAllForUser` —
 * force re-authentication everywhere, including the current device, same as
 * reset-password. Wrong current password reuses `401 INVALID_CREDENTIALS`, the same
 * vocabulary `login.service.ts` already uses, not a new code.
 */
@Injectable()
export class ChangePasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async change(userId: string, dto: ChangePasswordDto): Promise<ChangePasswordResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    const invalidCredentials = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Current password is incorrect.',
    });
    if (
      !user?.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw invalidCredentials;
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { updatedAt: true },
    });

    // Any existing sessions are now suspect — force re-authentication everywhere,
    // including the device that just made this request.
    await this.refreshTokens.revokeAllForUser(userId);

    return { status: 'PASSWORD_CHANGED', updatedAt: updated.updatedAt };
  }
}

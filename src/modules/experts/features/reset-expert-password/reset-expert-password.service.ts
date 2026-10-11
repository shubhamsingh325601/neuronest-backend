import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { ResetExpertPasswordDto } from './dto/reset-expert-password.dto';

/**
 * Admin sets a new password for an expert. Every refresh token of the expert is revoked, so
 * each signed-in device is signed out once its short-lived access token runs out and must
 * log in again with the new password (same as change-password and reset-password).
 */
@Injectable()
export class ResetExpertPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async reset(id: string, dto: ResetExpertPasswordDto): Promise<void> {
    const expert = await this.prisma.user.findFirst({
      where: { id, role: Role.EXPERT },
      select: { id: true },
    });
    if (!expert) {
      throw new NotFoundException({ code: 'EXPERT_NOT_FOUND', message: 'No expert with that id.' });
    }
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });
    await this.refreshTokens.revokeAllForUser(id);
  }
}

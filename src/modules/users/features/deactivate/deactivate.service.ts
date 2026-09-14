import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { DeactivateResponseDto } from './dto/deactivate.dto';

/**
 * Self-exclusion. Sets `selfExcludedAt` + `status = DEACTIVATED` and kills every
 * session. Only an admin (a later phase) can reverse this; login stays blocked
 * until then via the ACCOUNT_NOT_ACTIVE gate.
 */
@Injectable()
export class DeactivateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async deactivate(userId: string): Promise<DeactivateResponseDto> {
    const now = new Date();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DEACTIVATED, selfExcludedAt: now },
      select: { status: true, selfExcludedAt: true },
    });
    await this.refreshTokens.revokeAllForUser(userId);
    return { status: user.status, selfExcludedAt: user.selfExcludedAt as Date };
  }
}

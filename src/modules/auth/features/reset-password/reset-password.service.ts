import { BadRequestException, Injectable } from '@nestjs/common';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ResetPasswordDto, ResetPasswordResponseDto } from './dto/reset-password.dto';

@Injectable()
export class ResetPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async reset(dto: ResetPasswordDto): Promise<ResetPasswordResponseDto> {
    const userId = await this.verificationTokens.consumePasswordResetToken(dto.token);
    if (!userId) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'The reset link is invalid or has expired.',
      });
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Any existing sessions are now suspect — force re-authentication everywhere.
    await this.refreshTokens.revokeAllForUser(userId);

    return { reset: true };
  }
}

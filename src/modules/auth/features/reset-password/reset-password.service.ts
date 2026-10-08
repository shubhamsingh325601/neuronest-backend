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
    const viaToken = dto.token !== undefined;
    const viaCode = dto.email !== undefined || dto.code !== undefined;
    if (viaToken === viaCode || (viaCode && (dto.email === undefined || dto.code === undefined))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide either `token`, or both `email` and `code`.',
      });
    }

    const userId = viaToken
      ? await this.verificationTokens.consumePasswordResetToken(dto.token as string)
      : await this.consumeCode(dto.email as string, dto.code as string);
    if (!userId) {
      // One message for every failure, so a caller cannot tell a wrong code from an unknown account.
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'The reset link or code is invalid or has expired.',
      });
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // The other secret (link or code) must not stay usable once one of them has been spent.
    await this.verificationTokens.revokePasswordReset(userId);
    // Any existing sessions are now suspect — force re-authentication everywhere.
    await this.refreshTokens.revokeAllForUser(userId);

    return { reset: true };
  }

  private async consumeCode(email: string, code: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });
    if (!user) {
      return null;
    }
    return (await this.verificationTokens.verifyPasswordResetCode(user.id, code)) ? user.id : null;
  }
}

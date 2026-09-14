import { BadRequestException, Injectable } from '@nestjs/common';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import {
  ResendVerificationDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
} from './dto/verify-email.dto';

@Injectable()
export class VerifyEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
  ) {}

  async verify(dto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Generic failure for unknown email — do not leak which addresses are registered.
    if (!user) {
      throw this.invalidCode();
    }
    if (user.emailVerifiedAt) {
      return { verified: true };
    }

    const ok = await this.verificationTokens.verifyEmailCode(user.id, dto.code);
    if (!ok) {
      throw this.invalidCode();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async resend(dto: ResendVerificationDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const code = await this.verificationTokens.issueEmailVerificationCode(user.id);
      await this.email.sendEmailVerificationCode(user.email, code);
    }
    // Always resolves — response is 202 regardless, so callers cannot probe for accounts.
  }

  private invalidCode(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_VERIFICATION_CODE',
      message: 'The verification code is invalid or has expired.',
    });
  }
}

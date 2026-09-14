import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Injectable()
export class ForgotPasswordService {
  private readonly appWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appWebUrl = config.get('appWebUrl', { infer: true });
  }

  /** Always resolves — the endpoint responds 202 no matter what, so it cannot be
   *  used to discover which email addresses have accounts. */
  async requestReset(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    const token = await this.verificationTokens.issuePasswordResetToken(user.id);
    const resetUrl = `${this.appWebUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.email.sendPasswordResetLink(user.email, resetUrl);
  }
}

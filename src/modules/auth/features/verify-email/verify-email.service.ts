import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthEmailJobs } from '@modules/auth/jobs/auth-email.jobs';
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
    private readonly emailJobs: AuthEmailJobs,
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
      await this.emailJobs.enqueueVerificationCode(this.prisma, user.id);
      await this.emailJobs.kick();
    }
    // Always resolves — response is 202 regardless (the send is async, so a provider failure
    // cannot surface here either), so callers cannot probe for accounts.
  }

  private invalidCode(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_VERIFICATION_CODE',
      message: 'The verification code is invalid or has expired.',
    });
  }
}

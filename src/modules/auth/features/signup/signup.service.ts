import { ConflictException, Injectable } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
  ) {}

  async signup(dto: SignupDto): Promise<SignupResponseDto> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.emailVerifiedAt) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists.',
        });
      }
      // Unverified account — resend a fresh code rather than erroring.
      await this.sendCode(existing.id, existing.email);
      return { id: existing.id, email: existing.email };
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: dto.name.trim(),
        role: Role.PARENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });

    await this.sendCode(user.id, user.email);
    return { id: user.id, email: user.email };
  }

  private async sendCode(userId: string, email: string): Promise<void> {
    const code = await this.verificationTokens.issueEmailVerificationCode(userId);
    await this.email.sendEmailVerificationCode(email, code);
  }
}

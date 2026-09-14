import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { SessionTokensDto } from '@modules/auth/shared/session-tokens.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async login(dto: LoginDto): Promise<SessionTokensDto> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const invalidCredentials = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });

    if (!user) {
      throw invalidCredentials;
    }
    // An INVITED account (clinician provisioned by an admin) has no password until
    // account setup completes. Treat it as a credential failure — same opaque error,
    // no account-state disclosure.
    if (!user.passwordHash) {
      throw invalidCredentials;
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw invalidCredentials;
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address before logging in.',
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'This account is not active.',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.refreshTokens.issueSession(user);
  }
}

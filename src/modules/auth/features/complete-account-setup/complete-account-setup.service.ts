import { BadRequestException, Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import {
  CompleteAccountSetupDto,
  CompleteAccountSetupResponseDto,
} from './dto/complete-account-setup.dto';

/**
 * Completes account setup for an INVITED user (a clinician provisioned when an admin
 * approved their application). Mirrors reset-password: an opaque, single-use token
 * resolves to the user, whose first password is then set. On success the account
 * becomes ACTIVE and its email is marked verified — the setup link, sent to that
 * address, is itself the proof of control. No sessions to revoke: an INVITED account
 * has never authenticated.
 */
@Injectable()
export class CompleteAccountSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly verificationTokens: VerificationTokenService,
  ) {}

  async complete(dto: CompleteAccountSetupDto): Promise<CompleteAccountSetupResponseDto> {
    const userId = await this.verificationTokens.consumeAccountSetupToken(dto.token);
    if (!userId) {
      throw new BadRequestException({
        code: 'INVALID_SETUP_TOKEN',
        message: 'The account-setup link is invalid or has expired.',
      });
    }

    const passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    return { complete: true };
  }
}

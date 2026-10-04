import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, UserStatus, type User } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthEmailJobs } from '@modules/auth/jobs/auth-email.jobs';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly emailJobs: AuthEmailJobs,
  ) {}

  async signup(dto: SignupDto): Promise<SignupResponseDto> {
    const email = dto.email.toLowerCase().trim();
    const name = dto.name.trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return this.restartUnverified(existing, dto.password, name);
    }

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      // The user row and its verification-email job commit together (outbox): a signup can
      // never leave an account without a queued code.
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            role: Role.PARENT,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: null,
          },
        });
        await this.emailJobs.enqueueVerificationCode(tx, created.id);
        return created;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      // A concurrent signup created the row first — treat it as the existing-user case.
      const raced = await this.prisma.user.findUnique({ where: { email } });
      if (!raced) {
        throw error;
      }
      return this.restartUnverified(raced, dto.password, name);
    }

    await this.emailJobs.kick();
    return { id: user.id, email: user.email };
  }

  /**
   * Signup for an email that already has a row. Only an unverified PARENT may be
   * re-claimed: its credentials are replaced (so whoever verifies the code owns the
   * password), every session is revoked, and a fresh code is queued — one transaction.
   * Anything else (verified, or an INVITED clinician / ADMIN row) is a 409 with no mutation.
   */
  private async restartUnverified(
    existing: Pick<User, 'id' | 'email' | 'role' | 'emailVerifiedAt'>,
    password: string,
    name: string,
  ): Promise<SignupResponseDto> {
    if (existing.emailVerifiedAt || existing.role !== Role.PARENT) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account with this email already exists.',
      });
    }

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash, name } });
      await tx.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.emailJobs.enqueueVerificationCode(tx, existing.id, { replaceOutstanding: true });
    });
    await this.emailJobs.kick();
    return { id: existing.id, email: existing.email };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationChannel, VerificationTokenType } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import {
  generateNumericCode,
  generateOpaqueToken,
  safeEqualHex,
  sha256,
} from '@common/crypto/token.util';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * Issues and verifies the one-time secrets behind email verification, password
 * reset, and clinician account setup. All are rows in `verification_tokens`,
 * differing only by `type` and the secret's shape:
 *   - EMAIL_VERIFICATION: 6-digit code the user types, attempt-limited.
 *   - PASSWORD_RESET: opaque high-entropy token delivered as a link.
 *   - ACCOUNT_SETUP: opaque high-entropy token delivered as a link — same shape as
 *     PASSWORD_RESET, issued when an admin approves a clinician application.
 */
@Injectable()
export class VerificationTokenService {
  private readonly emailTtlMs: number;
  private readonly emailMaxAttempts: number;
  private readonly resetTtlMs: number;
  private readonly accountSetupTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const v = config.get('verification', { infer: true });
    this.emailTtlMs = v.emailTtlMin * 60_000;
    this.emailMaxAttempts = v.emailMaxAttempts;
    this.resetTtlMs = v.passwordResetTtlMin * 60_000;
    this.accountSetupTtlMs = v.accountSetupTtlMin * 60_000;
  }

  /** Consume any outstanding email codes for the user and issue a fresh one. */
  async issueEmailVerificationCode(userId: string): Promise<string> {
    await this.consumeOutstanding(userId, VerificationTokenType.EMAIL_VERIFICATION);
    const code = generateNumericCode(6);
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        channel: VerificationChannel.EMAIL,
        tokenHash: sha256(code),
        expiresAt: new Date(Date.now() + this.emailTtlMs),
      },
    });
    return code;
  }

  /**
   * Check a submitted code. Returns true and consumes the token on success.
   * Increments the attempt counter; consumes the token once attempts are exhausted.
   */
  async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    const token = await this.prisma.verificationToken.findFirst({
      where: {
        userId,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) {
      return false;
    }

    if (token.attempts >= this.emailMaxAttempts) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException({
        code: 'VERIFICATION_ATTEMPTS_EXCEEDED',
        message: 'Too many incorrect attempts. Request a new code.',
      });
    }

    const matches = safeEqualHex(token.tokenHash, sha256(code));
    if (!matches) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  /** Issue a password-reset token. Returns the plaintext for the email link. */
  async issuePasswordResetToken(userId: string): Promise<string> {
    await this.consumeOutstanding(userId, VerificationTokenType.PASSWORD_RESET);
    const token = generateOpaqueToken(32);
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type: VerificationTokenType.PASSWORD_RESET,
        channel: VerificationChannel.EMAIL,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.resetTtlMs),
      },
    });
    return token;
  }

  /** Resolve a password-reset token to its user id, consuming it. Null if invalid. */
  async consumePasswordResetToken(token: string): Promise<string | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: {
        type: VerificationTokenType.PASSWORD_RESET,
        tokenHash: sha256(token),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      return null;
    }
    await this.prisma.verificationToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return row.userId;
  }

  /** Issue an account-setup token. Returns the plaintext for the email link. */
  async issueAccountSetupToken(userId: string): Promise<string> {
    await this.consumeOutstanding(userId, VerificationTokenType.ACCOUNT_SETUP);
    const token = generateOpaqueToken(32);
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type: VerificationTokenType.ACCOUNT_SETUP,
        channel: VerificationChannel.EMAIL,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.accountSetupTtlMs),
      },
    });
    return token;
  }

  /** Resolve an account-setup token to its user id, consuming it. Null if invalid. */
  async consumeAccountSetupToken(token: string): Promise<string | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: {
        type: VerificationTokenType.ACCOUNT_SETUP,
        tokenHash: sha256(token),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      return null;
    }
    await this.prisma.verificationToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return row.userId;
  }

  private async consumeOutstanding(userId: string, type: VerificationTokenType): Promise<void> {
    await this.prisma.verificationToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}

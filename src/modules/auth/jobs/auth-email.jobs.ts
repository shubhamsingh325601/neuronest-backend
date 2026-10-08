import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from '@common/email/email.service';
import { buildWebLink } from '@common/email/web-link.util';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { minuteBucket, payloadUserId } from '@common/jobs/job-payload.util';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';

export const EMAIL_VERIFICATION_JOB = 'email.verification-code';
export const PASSWORD_RESET_JOB = 'email.password-reset';

/**
 * Verification-code and password-reset emails as queue jobs (plan 0011 §3 rows 7-9, 14).
 * The payload is only `{ userId }`: the handler mints the code/token at send time (which
 * also consumes earlier ones), so no secret is ever stored in `jobs`. Handlers re-check
 * state and complete as a no-op when the precondition is gone (already verified, user
 * deleted). At-least-once delivery means a rare duplicate email can invalidate the first
 * code/link — accepted.
 */
@Injectable()
export class AuthEmailJobs implements OnModuleInit {
  private readonly appWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
    private readonly registry: JobHandlerRegistry,
    private readonly queue: JobQueueService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appWebUrl = config.get('appWebUrl', { infer: true });
  }

  onModuleInit(): void {
    this.registry.register(EMAIL_VERIFICATION_JOB, async (job) =>
      this.sendVerificationCode(payloadUserId(job)),
    );
    this.registry.register(PASSWORD_RESET_JOB, async (job) =>
      this.sendPasswordReset(payloadUserId(job)),
    );
  }

  /**
   * Enqueue inside the caller's transaction; a double-click in the same minute collapses.
   *
   * `replaceOutstanding` is for a signup that just replaced the account's credentials
   * (plan 0009 B-1): every outstanding code is consumed in the same transaction so an
   * earlier code dies immediately — not whenever the queued send eventually runs — and the
   * job gets a fresh key so it is never collapsed into an earlier one.
   */
  async enqueueVerificationCode(
    db: Prisma.TransactionClient,
    userId: string,
    options: { replaceOutstanding?: boolean } = {},
  ): Promise<boolean> {
    if (options.replaceOutstanding) {
      await this.verificationTokens.revokeEmailVerification(userId, db);
    }
    return this.queue.enqueue(db, {
      type: EMAIL_VERIFICATION_JOB,
      payload: { userId },
      dedupeKey: options.replaceOutstanding
        ? `${EMAIL_VERIFICATION_JOB}:${userId}:${randomUUID()}`
        : `${EMAIL_VERIFICATION_JOB}:${userId}:${minuteBucket()}`,
    });
  }

  enqueuePasswordReset(db: Prisma.TransactionClient, userId: string): Promise<boolean> {
    return this.queue.enqueue(db, {
      type: PASSWORD_RESET_JOB,
      payload: { userId },
      dedupeKey: `${PASSWORD_RESET_JOB}:${userId}:${minuteBucket()}`,
    });
  }

  /** Post-commit nudge; never throws and never required for correctness. */
  kick(): Promise<void> {
    return this.queue.kick();
  }

  async sendVerificationCode(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) {
      return;
    }
    const code = await this.verificationTokens.issueEmailVerificationCode(userId);
    await this.email.sendEmailVerificationCode(user.email, code);
  }

  async sendPasswordReset(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return;
    }
    const token = await this.verificationTokens.issuePasswordResetToken(userId);
    const code = await this.verificationTokens.issuePasswordResetCode(userId);
    await this.email.sendPasswordResetLink(
      user.email,
      buildWebLink(this.appWebUrl, '/reset-password', token),
      code,
    );
  }
}

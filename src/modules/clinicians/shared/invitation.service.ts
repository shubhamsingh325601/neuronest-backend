import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus, type Prisma } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from '@common/email/email.service';
import { buildWebLink } from '@common/email/web-link.util';
import { JobHandlerRegistry } from '@common/jobs/job-handler.registry';
import { payloadUserId } from '@common/jobs/job-payload.util';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';

export const ACCOUNT_SETUP_JOB = 'email.account-setup';

/**
 * The clinician invitation sender (plan 0010 §3 row 3, queued in plan 0011): the
 * `email.account-setup` job handler mints an ACCOUNT_SETUP token at send time (which
 * consumes earlier outstanding ones), builds the setup link, and emails it. The payload
 * is only `{ userId }` — never a secret. Callers enqueue inside their transaction and kick
 * after commit, so a mail failure never rolls back the clinician (the job retries, and
 * lands in the admin DEAD list if the provider stays down).
 */
@Injectable()
export class InvitationService implements OnModuleInit {
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
    this.registry.register(ACCOUNT_SETUP_JOB, async (job) => this.issueAndSend(payloadUserId(job)));
  }

  /**
   * Enqueue an invitation email. Every call uses a fresh key (a deliberate create/resend
   * must send), so only retries of the *same* job are deduplicated by the queue itself.
   */
  enqueue(db: Prisma.TransactionClient, userId: string): Promise<boolean> {
    return this.queue.enqueue(db, {
      type: ACCOUNT_SETUP_JOB,
      payload: { userId },
      dedupeKey: `${ACCOUNT_SETUP_JOB}:${userId}:${randomUUID()}`,
    });
  }

  /** Post-commit nudge; never throws and never required for correctness. */
  kick(): Promise<void> {
    return this.queue.kick();
  }

  /**
   * Handler body. Re-checks state at run time: a clinician who is no longer `INVITED`
   * (activated, suspended, deleted) gets no email — the job completes as a no-op.
   * Throws when sending fails so the queue retries.
   */
  async issueAndSend(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (!user || user.status !== UserStatus.INVITED) {
      return;
    }
    const token = await this.verificationTokens.issueAccountSetupToken(userId);
    const setupUrl = buildWebLink(this.appWebUrl, '/complete-account-setup', token);
    await this.email.sendAccountSetupLink(user.email, setupUrl);
  }
}

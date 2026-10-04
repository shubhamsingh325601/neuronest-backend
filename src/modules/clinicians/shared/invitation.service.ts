import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from '@common/email/email.service';
import { buildWebLink } from '@common/email/web-link.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';

/**
 * The clinician invitation sender (plan 0010 §3 row 3): mint an ACCOUNT_SETUP token
 * (which consumes earlier outstanding ones), build the setup link, email it. The token
 * is minted at send time so a queued payload never has to carry a secret — in plan 0011
 * this same method becomes the job handler without changing the HTTP contract.
 */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);
  private readonly appWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appWebUrl = config.get('appWebUrl', { infer: true });
  }

  /** Issue a fresh token and email the link. Throws if the user is missing or sending fails. */
  async issueAndSend(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const token = await this.verificationTokens.issueAccountSetupToken(userId);
    const setupUrl = buildWebLink(this.appWebUrl, '/complete-account-setup', token);
    await this.email.sendAccountSetupLink(user.email, setupUrl);
  }

  /**
   * Same, but a failure never propagates — creation/update must not roll back because
   * the mail provider hiccuped. The admin sees the clinician still `INVITED` and can
   * resend. Logs only the user id and error message (never the link).
   */
  async sendBestEffort(userId: string): Promise<void> {
    try {
      await this.issueAndSend(userId);
    } catch (err) {
      this.logger.error(
        { userId, err: err instanceof Error ? err.message : String(err) },
        'Clinician invitation email failed; admin can resend.',
      );
      Sentry.captureException(err);
    }
  }
}

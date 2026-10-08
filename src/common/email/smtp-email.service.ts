import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '@common/config/configuration';
import { extractAddress, maskEmail } from './email-address.util';
import { EmailService } from './email.service';
import { accountSetupEmail } from './templates/account-setup.template';
import { passwordResetEmail } from './templates/password-reset.template';
import { verificationCodeEmail } from './templates/verification-code.template';
import type { RenderedEmail } from './templates/verification-code.template';

/** Network-level failures; on a PaaS these usually mean outbound SMTP is blocked, not bad credentials. */
const NETWORK_ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED']);
const SMTP_TIMEOUT_MS = 10_000;

/**
 * SMTP-backed implementation (Gmail + App Password by default). Selected with `EMAIL_PROVIDER=smtp`;
 * it needs no verified domain, so it is the stage-0 option while a sending domain is not set up.
 *
 * Like {@link ResendEmailService}, an unset `SMTP_USER`/`SMTP_PASSWORD` degrades to logging the
 * rendered message instead of throwing (local dev). Failures throw, so the queue job retries and
 * eventually goes DEAD (with a Sentry event) rather than losing the email silently.
 */
@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  private readonly verificationTtlMin: number;
  private readonly passwordResetTtlMin: number;
  private readonly accountSetupTtlHours: number;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const email = config.get('email', { infer: true });
    const verification = config.get('verification', { infer: true });
    const { smtp } = email;
    this.from = email.from;
    this.verificationTtlMin = verification.emailTtlMin;
    this.passwordResetTtlMin = verification.passwordResetTtlMin;
    this.accountSetupTtlHours = verification.accountSetupTtlHours;

    if (smtp.user && smtp.password) {
      this.transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.password },
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
      });
      if (extractAddress(this.from) !== smtp.user.toLowerCase()) {
        this.logger.warn(
          'EMAIL_FROM differs from SMTP_USER — Gmail and most SMTP relays rewrite or reject a ' +
            'sender that is not the authenticated mailbox.',
        );
      }
    } else {
      this.transport = null;
      this.logger.warn('SMTP_USER/SMTP_PASSWORD are unset — emails will be logged, not sent.');
    }
  }

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    await this.dispatch(to, verificationCodeEmail(code, this.verificationTtlMin));
  }

  async sendPasswordResetLink(to: string, resetUrl: string): Promise<void> {
    await this.dispatch(to, passwordResetEmail(resetUrl, this.passwordResetTtlMin));
  }

  async sendAccountSetupLink(to: string, setupUrl: string): Promise<void> {
    await this.dispatch(to, accountSetupEmail(setupUrl, this.accountSetupTtlHours));
  }

  private async dispatch(to: string, message: RenderedEmail): Promise<void> {
    if (!this.transport) {
      this.logger.debug({ to, subject: message.subject, body: message.text }, 'Email (not sent)');
      return;
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (err) {
      const {
        code,
        responseCode,
        message: reason,
      } = err as NodeJS.ErrnoException & {
        responseCode?: number;
      };
      this.logger.error(
        {
          to: maskEmail(to),
          code,
          responseCode,
          reason,
          ...(code && NETWORK_ERROR_CODES.has(code)
            ? { hint: 'Outbound SMTP may be blocked (Render free tier blocks ports 25/465/587).' }
            : {}),
        },
        'SMTP send failed',
      );
      throw new Error(`Failed to send email: ${reason}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { maskEmail, parseSender } from './email-address.util';
import { EmailService } from './email.service';
import { accountSetupEmail } from './templates/account-setup.template';
import { passwordResetEmail } from './templates/password-reset.template';
import { verificationCodeEmail } from './templates/verification-code.template';
import type { RenderedEmail } from './templates/verification-code.template';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 10_000;

/**
 * Brevo transactional-email implementation over HTTPS (`POST /v3/smtp/email`). Selected with
 * `EMAIL_PROVIDER=brevo`. Needs no sending domain: verify a single sender address in Brevo and use
 * it as `EMAIL_FROM`. HTTPS, so PaaS hosts that block outbound SMTP ports (Render free) are fine.
 *
 * Like {@link ResendEmailService}, an unset `BREVO_API_KEY` degrades to logging the rendered message
 * (local dev). Failures throw, so the queue job retries and eventually goes DEAD with a Sentry event.
 */
@Injectable()
export class BrevoEmailService extends EmailService {
  private readonly logger = new Logger(BrevoEmailService.name);
  private readonly apiKey: string;
  private readonly sender: { name?: string; email: string } | null;
  private readonly verificationTtlMin: number;
  private readonly passwordResetTtlMin: number;
  private readonly accountSetupTtlHours: number;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const email = config.get('email', { infer: true });
    const verification = config.get('verification', { infer: true });
    this.apiKey = email.brevoApiKey;
    this.sender = parseSender(email.from);
    this.verificationTtlMin = verification.emailTtlMin;
    this.passwordResetTtlMin = verification.passwordResetTtlMin;
    this.accountSetupTtlHours = verification.accountSetupTtlHours;
    if (!this.apiKey) {
      this.logger.warn('BREVO_API_KEY is unset — emails will be logged, not sent.');
    } else if (!this.sender) {
      this.logger.warn('EMAIL_FROM has no address — Brevo requires a verified sender address.');
    }
  }

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    await this.dispatch(to, verificationCodeEmail(code, this.verificationTtlMin));
  }

  async sendPasswordResetLink(to: string, resetUrl: string, code?: string): Promise<void> {
    await this.dispatch(to, passwordResetEmail(resetUrl, this.passwordResetTtlMin, code));
  }

  async sendAccountSetupLink(to: string, setupUrl: string): Promise<void> {
    await this.dispatch(to, accountSetupEmail(setupUrl, this.accountSetupTtlHours));
  }

  private async dispatch(to: string, message: RenderedEmail): Promise<void> {
    if (!this.apiKey) {
      this.logger.debug({ to, subject: message.subject, body: message.text }, 'Email (not sent)');
      return;
    }
    let response: Response;
    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error({ to: maskEmail(to), reason }, 'Brevo send failed (network)');
      throw new Error(`Failed to send email: ${reason}`);
    }
    if (!response.ok) {
      // Brevo returns `{ code, message }`, e.g. 401 "Key not found", 400 "sender is not valid /
      // not activated". Log the reason (never the key) so a misconfigured sender is diagnosable.
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      const reason = body.message ?? response.statusText;
      this.logger.error(
        { to: maskEmail(to), statusCode: response.status, name: body.code, reason },
        'Brevo send failed',
      );
      throw new Error(`Failed to send email: ${reason}`);
    }
  }
}

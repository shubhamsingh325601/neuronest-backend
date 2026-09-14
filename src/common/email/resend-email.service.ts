import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from './email.service';
import { accountSetupEmail } from './templates/account-setup.template';
import { passwordResetEmail } from './templates/password-reset.template';
import { verificationCodeEmail } from './templates/verification-code.template';
import type { RenderedEmail } from './templates/verification-code.template';

/**
 * Real Resend-backed implementation.
 *
 * When `RESEND_API_KEY` is unset (local dev without email credentials) the service
 * degrades to logging the rendered message instead of throwing, so the auth flows
 * remain testable end-to-end. Verification codes are logged at debug level in that mode.
 */
@Injectable()
export class ResendEmailService extends EmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;
  private readonly verificationTtlMin: number;
  private readonly passwordResetTtlMin: number;
  private readonly accountSetupTtlMin: number;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const email = config.get('email', { infer: true });
    const verification = config.get('verification', { infer: true });
    this.from = email.from;
    this.verificationTtlMin = verification.emailTtlMin;
    this.passwordResetTtlMin = verification.passwordResetTtlMin;
    this.accountSetupTtlMin = verification.accountSetupTtlMin;
    this.client = email.resendApiKey ? new Resend(email.resendApiKey) : null;
    if (!this.client) {
      this.logger.warn('RESEND_API_KEY is unset — emails will be logged, not sent.');
    }
  }

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    await this.dispatch(to, verificationCodeEmail(code, this.verificationTtlMin));
  }

  async sendPasswordResetLink(to: string, resetUrl: string): Promise<void> {
    await this.dispatch(to, passwordResetEmail(resetUrl, this.passwordResetTtlMin));
  }

  async sendAccountSetupLink(to: string, setupUrl: string): Promise<void> {
    await this.dispatch(to, accountSetupEmail(setupUrl, this.accountSetupTtlMin));
  }

  private async dispatch(to: string, message: RenderedEmail): Promise<void> {
    if (!this.client) {
      this.logger.debug({ to, subject: message.subject, body: message.text }, 'Email (not sent)');
      return;
    }
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      this.logger.error({ to, err: error }, 'Resend send failed');
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}

import { EmailService } from '@common/email/email.service';

export interface SentEmail {
  kind: 'verification-code' | 'password-reset' | 'account-setup';
  to: string;
  code?: string;
  resetUrl?: string;
  resetCode?: string;
  setupUrl?: string;
}

/** In-memory EmailService used by e2e tests to read back what would have been sent. */
export class FakeEmailService extends EmailService {
  readonly sent: SentEmail[] = [];
  /** When true, every send rejects — simulates a provider outage. */
  failSends = false;

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    this.guard();
    this.sent.push({ kind: 'verification-code', to, code });
  }

  async sendPasswordResetLink(to: string, resetUrl: string, resetCode?: string): Promise<void> {
    this.guard();
    this.sent.push({ kind: 'password-reset', to, resetUrl, resetCode });
  }

  async sendAccountSetupLink(to: string, setupUrl: string): Promise<void> {
    this.guard();
    this.sent.push({ kind: 'account-setup', to, setupUrl });
  }

  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.code)?.code;
  }

  lastResetUrlFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.resetUrl)?.resetUrl;
  }

  lastResetCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.resetCode)?.resetCode;
  }

  lastSetupUrlFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.setupUrl)?.setupUrl;
  }

  clear(): void {
    this.sent.length = 0;
  }

  private guard(): void {
    if (this.failSends) {
      throw new Error('Simulated email provider outage');
    }
  }
}

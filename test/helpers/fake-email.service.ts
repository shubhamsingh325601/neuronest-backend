import { EmailService } from '@common/email/email.service';

export interface SentEmail {
  kind: 'verification-code' | 'password-reset' | 'account-setup';
  to: string;
  code?: string;
  resetUrl?: string;
  setupUrl?: string;
}

/** In-memory EmailService used by e2e tests to read back what would have been sent. */
export class FakeEmailService extends EmailService {
  readonly sent: SentEmail[] = [];

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    this.sent.push({ kind: 'verification-code', to, code });
  }

  async sendPasswordResetLink(to: string, resetUrl: string): Promise<void> {
    this.sent.push({ kind: 'password-reset', to, resetUrl });
  }

  async sendAccountSetupLink(to: string, setupUrl: string): Promise<void> {
    this.sent.push({ kind: 'account-setup', to, setupUrl });
  }

  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.code)?.code;
  }

  lastResetUrlFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.resetUrl)?.resetUrl;
  }

  lastSetupUrlFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.setupUrl)?.setupUrl;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

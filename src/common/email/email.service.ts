/**
 * Provider-agnostic email contract. Injected by this abstract class as the DI token;
 * bound by `EMAIL_PROVIDER` to {@link ResendEmailService} or {@link BrevoEmailService}
 * (see `email-provider.factory.ts`) and to an in-memory fake in tests.
 */
export abstract class EmailService {
  abstract sendEmailVerificationCode(to: string, code: string): Promise<void>;

  abstract sendPasswordResetLink(to: string, resetUrl: string, code?: string): Promise<void>;

  abstract sendAccountSetupLink(to: string, setupUrl: string): Promise<void>;
}

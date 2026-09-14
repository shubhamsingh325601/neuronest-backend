/**
 * Provider-agnostic email contract. Injected by this abstract class as the DI token;
 * bound to {@link ResendEmailService} in production and to an in-memory fake in tests.
 */
export abstract class EmailService {
  abstract sendEmailVerificationCode(to: string, code: string): Promise<void>;

  abstract sendPasswordResetLink(to: string, resetUrl: string): Promise<void>;

  abstract sendAccountSetupLink(to: string, setupUrl: string): Promise<void>;
}

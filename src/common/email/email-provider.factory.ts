import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { BrevoEmailService } from './brevo-email.service';
import { EmailService } from './email.service';
import { ResendEmailService } from './resend-email.service';

/** Binds `EMAIL_PROVIDER` to an {@link EmailService}. */
export function createEmailService(config: ConfigService<AppConfig, true>): EmailService {
  const { provider } = config.get('email', { infer: true });
  return provider === 'brevo' ? new BrevoEmailService(config) : new ResendEmailService(config);
}

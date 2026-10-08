import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from './email.service';
import { ResendEmailService } from './resend-email.service';
import { SmtpEmailService } from './smtp-email.service';

/** Binds `EMAIL_PROVIDER` to an {@link EmailService}. */
export function createEmailService(config: ConfigService<AppConfig, true>): EmailService {
  const { provider } = config.get('email', { infer: true });
  return provider === 'smtp' ? new SmtpEmailService(config) : new ResendEmailService(config);
}

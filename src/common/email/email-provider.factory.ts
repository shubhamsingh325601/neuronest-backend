import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { isPlaceholderSender } from './email-address.util';
import { EmailService } from './email.service';
import { ResendEmailService } from './resend-email.service';
import { SmtpEmailService } from './smtp-email.service';

/**
 * Binds `EMAIL_PROVIDER` to an {@link EmailService}. Also warns at boot when `EMAIL_FROM` is an
 * example/test domain outside production (production refuses to boot — see `validateEmailEnv`),
 * so a log-only dev setup is not mistaken for a working one.
 */
export function createEmailService(config: ConfigService<AppConfig, true>): EmailService {
  const { provider, from } = config.get('email', { infer: true });
  if (isPlaceholderSender(from)) {
    new Logger('EmailModule').warn(
      `EMAIL_FROM "${from}" uses an example/test domain or has no address; real providers will ` +
        'reject it. See README, Email setup.',
    );
  }
  return provider === 'smtp' ? new SmtpEmailService(config) : new ResendEmailService(config);
}

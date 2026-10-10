import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';

/**
 * Checks the `callbackUrl` a client sends (the frontend page an emailed link should open).
 * Only our own origins are accepted (`APP_WEB_URL` and `CORS_ORIGINS`); otherwise we could be
 * made to email a victim a "reset your password" link that points at someone else's site.
 */
@Injectable()
export class CallbackUrlService {
  private readonly allowedOrigins: string[];

  constructor(config: ConfigService<AppConfig, true>) {
    this.allowedOrigins = [
      new URL(config.get('appWebUrl', { infer: true })).origin,
      ...config.get('cors', { infer: true }).origins,
    ];
  }

  /** Returns the URL unchanged, or throws 400. `undefined` (not sent) passes through. */
  assertAllowed(callbackUrl: string | undefined): string | undefined {
    if (callbackUrl !== undefined && !this.isAllowed(callbackUrl)) {
      throw new BadRequestException({
        code: 'INVALID_CALLBACK_URL',
        message: 'callbackUrl must be an http(s) URL on an origin this API allows.',
      });
    }
    return callbackUrl;
  }

  private isAllowed(raw: string): boolean {
    try {
      const url = new URL(raw);
      return (
        this.allowedOrigins.includes(url.origin) && // also rules out non-http schemes and `user@host` tricks
        url.hash === ''
      );
    } catch {
      return false;
    }
  }
}

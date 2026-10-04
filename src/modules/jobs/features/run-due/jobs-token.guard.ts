import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '@common/config/configuration';

/**
 * Guards the machine trigger (`@Public()` + shared secret — the one documented exception
 * to "every handler has an `@Auth`", see docs/rbac.md). Unset `JOBS_RUN_TOKEN` disables
 * the route entirely (404); a wrong or missing header is `401 INVALID_JOBS_TOKEN`.
 */
@Injectable()
export class JobsTokenGuard implements CanActivate {
  private readonly token: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.token = config.get('jobs', { infer: true }).runToken;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    }
    const header = context.switchToHttp().getRequest<Request>().headers['x-jobs-token'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !this.matches(provided)) {
      throw new UnauthorizedException({
        code: 'INVALID_JOBS_TOKEN',
        message: 'The jobs token is missing or invalid.',
      });
    }
    return true;
  }

  private matches(provided: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

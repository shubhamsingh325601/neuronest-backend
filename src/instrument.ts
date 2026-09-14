/**
 * Sentry initialisation. MUST be imported before any other application module
 * (see the first line of main.ts) so instrumentation can patch modules as they load.
 *
 * With no `SENTRY_DSN` set (the local-dev default) this is a no-op.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  });
}

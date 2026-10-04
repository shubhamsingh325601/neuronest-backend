import { HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { setupOpenApi } from '@common/openapi/openapi';

export interface ConfigureAppOptions {
  /** Overrides `TRUST_PROXY_HOPS` from config — e2e tests use this to exercise both modes. */
  trustProxyHops?: number;
}

/**
 * HTTP-pipeline setup shared by `main.ts` and the e2e `createTestApp()`, so the tests
 * exercise exactly what production runs. CORS and logger wiring stay in `main.ts`.
 */
export function configureApp(app: INestApplication, options: ConfigureAppOptions = {}): void {
  const config = app.get(ConfigService<AppConfig, true>);

  // Rate limiting keys on `req.ip`; behind a reverse proxy that is the proxy's address
  // unless Express is told how many hops to trust. A fixed integer — never `true`, which
  // would let a client spoof X-Forwarded-For. 0 (the default) trusts nothing.
  const hops = options.trustProxyHops ?? config.get('trustProxyHops', { infer: true });
  app.getHttpAdapter().getInstance().set('trust proxy', hops);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  setupOpenApi(app);
}

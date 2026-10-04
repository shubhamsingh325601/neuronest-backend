import { HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { setupOpenApi } from '@common/openapi/openapi';

/**
 * HTTP-pipeline setup shared by `main.ts` and the e2e `createTestApp()`, so the tests
 * exercise exactly what production runs. CORS and logger wiring stay in `main.ts`.
 */
export function configureApp(app: INestApplication): void {
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

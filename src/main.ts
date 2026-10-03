import './instrument';

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { AppConfig } from '@common/config/configuration';
import { buildCorsOptions } from '@common/config/cors';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { setupOpenApi } from '@common/openapi/openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

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

  const config = app.get(ConfigService<AppConfig, true>);

  // Registered before listen() so the cors middleware runs ahead of routing/guards and
  // answers OPTIONS preflights itself (never rate-limited or auth-checked).
  const { origins } = config.get('cors', { infer: true });
  app.enableCors(buildCorsOptions(origins));

  const port = config.get('port', { infer: true });
  await app.listen(port);

  const logger = app.get(PinoLogger);
  logger.log(`NeuroNest API listening on http://localhost:${port} (docs at /docs)`);
  logger.log(`CORS allowed origins: ${origins.length > 0 ? origins.join(', ') : '(none)'}`);
}

void bootstrap();

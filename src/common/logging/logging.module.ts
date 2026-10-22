import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '@common/config/configuration';
import { buildHttpLogOptions } from './http-log.options';

/**
 * Structured logging via nestjs-pino. Every request gets an `id` (logged as `reqId`, reused as
 * `requestId` in error responses and echoed in the `x-request-id` header). Secrets and tokens are
 * redacted. See {@link buildHttpLogOptions} for the line format.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: buildHttpLogOptions({
          level: config.get('logLevel', { infer: true }),
          format: config.get('logFormat', { infer: true }),
          appEnv: config.get('appEnv', { infer: true }),
        }),
      }),
    }),
  ],
})
export class LoggingModule {}

import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '@common/config/configuration';

/**
 * Structured logging via nestjs-pino. Every request gets an `id` (reused as
 * `requestId` in error responses). Secrets and tokens are redacted.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const isDev = config.get('env', { infer: true }) === 'development';
        return {
          pinoHttp: {
            level: config.get('logLevel', { infer: true }),
            genReqId: (req, res) => {
              const existing = req.headers['x-request-id'];
              const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            autoLogging: true,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.newPassword',
              'req.body.token',
              'req.body.refreshToken',
              'req.body.code',
              '*.password',
              '*.passwordHash',
              '*.newPassword',
              '*.token',
              '*.tokenHash',
              '*.accessToken',
              '*.refreshToken',
            ],
            transport: isDev
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}

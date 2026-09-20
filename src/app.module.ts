import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { configuration, type AppConfig } from '@common/config/configuration';
import { envValidationSchema } from '@common/config/env.validation';
import { AuthzModule } from '@common/authz/authz.module';
import { JwtAuthGuard } from '@common/authz/jwt-auth.guard';
import { PermissionsGuard } from '@common/authz/permissions.guard';
import { CryptoModule } from '@common/crypto/crypto.module';
import { EmailModule } from '@common/email/email.module';
import { LoggingModule } from '@common/logging/logging.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ChildrenModule } from '@modules/children/children.module';
import { CliniciansModule } from '@modules/clinicians/clinicians.module';
import { HealthModule } from '@modules/health/health.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    SentryModule.forRoot(),
    LoggingModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const throttle = config.get('throttle', { infer: true });
        return {
          throttlers: [
            { name: 'default', ttl: throttle.ttlSec * 1000, limit: throttle.limit },
          ],
        };
      },
    }),

    PrismaModule,
    CryptoModule,
    EmailModule,
    AuthzModule,

    AuthModule,
    UsersModule,
    CliniciansModule,
    ChildrenModule,
    HealthModule,
  ],
  providers: [
    // Guard order: rate limit -> authenticate -> authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

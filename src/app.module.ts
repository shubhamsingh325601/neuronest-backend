import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { configuration, type AppConfig } from '@common/config/configuration';
import { envValidationSchema } from '@common/config/env.validation';
import { AuthzModule } from '@common/authz/authz.module';
import { JwtAuthGuard } from '@common/authz/jwt-auth.guard';
import { PermissionsGuard } from '@common/authz/permissions.guard';
import { CryptoModule } from '@common/crypto/crypto.module';
import { EmailModule } from '@common/email/email.module';
import { JobsModule } from '@common/jobs/jobs.module';
import { LoggingModule } from '@common/logging/logging.module';
import { MediaStorageModule } from '@common/media-storage/media-storage.module';
import { AppThrottlerGuard } from '@common/throttler/app-throttler.guard';
import { PrismaModule } from '@common/prisma/prisma.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CallLogsModule } from '@modules/call-logs/call-logs.module';
import { ChildrenModule } from '@modules/children/children.module';
import { CoachingModule } from '@modules/coaching/coaching.module';
import { ConsentsModule } from '@modules/consents/consents.module';
import { CliniciansModule } from '@modules/clinicians/clinicians.module';
import { JobsHttpModule } from '@modules/jobs/jobs.module';
import { HealthModule } from '@modules/health/health.module';
import { MediaModule } from '@modules/media/media.module';
import { PlansModule } from '@modules/plans/plans.module';
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
          throttlers: [{ name: 'default', ttl: throttle.ttlSec * 1000, limit: throttle.limit }],
        };
      },
    }),

    PrismaModule,
    CryptoModule,
    EmailModule,
    JobsModule,
    MediaStorageModule,
    AuthzModule,

    AuthModule,
    UsersModule,
    CliniciansModule,
    ChildrenModule,
    ConsentsModule,
    CoachingModule,
    MediaModule,
    PlansModule,
    CallLogsModule,
    HealthModule,
    JobsHttpModule,
    AdminModule,
  ],
  providers: [
    // Guard order: authenticate -> rate limit -> authorize. The limiter keys on user id /
    // email / token (never the client IP), so it must run after JwtAuthGuard sets request.user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

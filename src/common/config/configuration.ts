/**
 * Typed configuration factory. Registered via `ConfigModule.forRoot({ load: [configuration] })`.
 * Inject with `ConfigService<AppConfig, true>` and read namespaced slices, e.g.
 * `config.get('jwt', { infer: true })`.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  appWebUrl: string;
  database: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  verification: {
    emailTtlMin: number;
    emailMaxAttempts: number;
    passwordResetTtlMin: number;
    accountSetupTtlMin: number;
  };
  email: {
    resendApiKey: string;
    from: string;
  };
  throttle: {
    ttlSec: number;
    limit: number;
  };
  sentry: {
    dsn: string;
  };
  logLevel: string;
  admin: {
    email: string;
    password: string;
    name: string;
  };
}

export const configuration = (): AppConfig => ({
  env: (process.env.NODE_ENV as AppConfig['env']) ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appWebUrl: process.env.APP_WEB_URL as string,
  database: {
    url: process.env.DATABASE_URL as string,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  },
  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY_KIB ?? '19456', 10),
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '2', 10),
    parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
  },
  verification: {
    emailTtlMin: parseInt(process.env.EMAIL_VERIFICATION_TTL_MIN ?? '10', 10),
    emailMaxAttempts: parseInt(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? '5', 10),
    passwordResetTtlMin: parseInt(process.env.PASSWORD_RESET_TTL_MIN ?? '60', 10),
    accountSetupTtlMin: parseInt(process.env.ACCOUNT_SETUP_TTL_MIN ?? '60', 10),
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM as string,
  },
  throttle: {
    ttlSec: parseInt(process.env.THROTTLE_TTL_SEC ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  admin: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME ?? 'NeuroNest Admin',
  },
});

import { parseCorsOrigins } from './cors';

/**
 * Typed configuration factory. Registered via `ConfigModule.forRoot({ load: [configuration] })`.
 * Inject with `ConfigService<AppConfig, true>` and read namespaced slices, e.g.
 * `config.get('jwt', { infer: true })`.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  appWebUrl: string;
  cors: {
    origins: string[];
  };
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
    accountSetupTtlHours: number;
  };
  email: {
    /** Which {@link EmailService} implementation is bound at boot. */
    provider: 'resend' | 'smtp';
    resendApiKey: string;
    from: string;
    smtp: {
      host: string;
      port: number;
      /** Implicit TLS (port 465). False = STARTTLS upgrade (port 587). */
      secure: boolean;
      user: string;
      password: string;
    };
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  throttle: {
    ttlSec: number;
    limit: number;
  };
  sentry: {
    dsn: string;
  };
  jobs: {
    enabled: boolean;
    sweepCron: string;
    visibilityTimeoutSec: number;
    batchSize: number;
    backoffBaseSec: number;
    backoffCapSec: number;
    maxAttempts: number;
    succeededRetentionDays: number;
    shutdownGraceSec: number;
    kickMode: 'async' | 'inline';
    /** Empty = the machine trigger `POST /v1/jobs/run-due` is disabled (404). */
    runToken: string;
  };
  media: {
    /** A media row still PENDING after this many hours is flipped to FAILED by the sweep. */
    pendingTtlHours: number;
  };
  ai: {
    enabled: boolean;
    /** `provider:model`, e.g. `google:gemini-3.5-flash-lite`. */
    model: string;
    /** Optional second attempt, same shape as `model`. Empty = none. */
    fallbackModel: string;
    /** Operator attestation that the provider account may receive real child-related data (gate G1). */
    allowRealData: boolean;
    timeoutMs: number;
    maxOutputTokens: number;
    userDailyLimit: number;
    dailyRequestBudget: number;
    outputRetentionDays: number;
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
  cors: {
    origins: parseCorsOrigins(process.env.CORS_ORIGINS),
  },
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
    accountSetupTtlHours: parseInt(process.env.ACCOUNT_SETUP_TTL_HOURS ?? '72', 10),
  },
  email: {
    provider: process.env.EMAIL_PROVIDER === 'smtp' ? 'smtp' : 'resend',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM as string,
    smtp: {
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT ?? '465', 10),
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : parseInt(process.env.SMTP_PORT ?? '465', 10) === 465,
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
    },
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  throttle: {
    ttlSec: parseInt(process.env.THROTTLE_TTL_SEC ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },
  jobs: {
    enabled: process.env.JOBS_ENABLED !== 'false',
    sweepCron: process.env.JOBS_SWEEP_CRON ?? '0 */10 * * * *',
    visibilityTimeoutSec: parseInt(process.env.JOBS_VISIBILITY_TIMEOUT_SEC ?? '300', 10),
    batchSize: parseInt(process.env.JOBS_BATCH_SIZE ?? '10', 10),
    backoffBaseSec: parseInt(process.env.JOBS_BACKOFF_BASE_SEC ?? '30', 10),
    backoffCapSec: parseInt(process.env.JOBS_BACKOFF_CAP_SEC ?? '3600', 10),
    maxAttempts: parseInt(process.env.JOBS_MAX_ATTEMPTS ?? '5', 10),
    succeededRetentionDays: parseInt(process.env.JOBS_SUCCEEDED_RETENTION_DAYS ?? '14', 10),
    shutdownGraceSec: parseInt(process.env.JOBS_SHUTDOWN_GRACE_SEC ?? '20', 10),
    kickMode: process.env.JOBS_KICK_MODE === 'inline' ? 'inline' : 'async',
    runToken: process.env.JOBS_RUN_TOKEN ?? '',
  },
  media: {
    pendingTtlHours: parseInt(process.env.MEDIA_PENDING_TTL_HOURS ?? '24', 10),
  },
  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    model: process.env.AI_MODEL ?? 'google:gemini-3.5-flash-lite',
    fallbackModel: process.env.AI_FALLBACK_MODEL ?? '',
    allowRealData: process.env.AI_ALLOW_REAL_DATA === 'true',
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? '10000', 10),
    maxOutputTokens: parseInt(process.env.AI_MAX_OUTPUT_TOKENS ?? '700', 10),
    userDailyLimit: parseInt(process.env.AI_USER_DAILY_LIMIT ?? '3', 10),
    dailyRequestBudget: parseInt(process.env.AI_DAILY_REQUEST_BUDGET ?? '400', 10),
    outputRetentionDays: parseInt(process.env.AI_OUTPUT_RETENTION_DAYS ?? '14', 10),
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  admin: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME ?? 'NeuroNest Admin',
  },
});

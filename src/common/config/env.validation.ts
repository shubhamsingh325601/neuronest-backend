import * as Joi from 'joi';
import { parseCorsOrigins } from './cors';

/**
 * Joi schema for process environment. Applied by `ConfigModule.forRoot({ validationSchema })`
 * so the process fails fast at boot when a required variable is missing or malformed,
 * rather than at the first request that needs it.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  APP_WEB_URL: Joi.string().uri().required(),
  // Comma-separated browser origins allowed to call the API (see common/config/cors.ts).
  // Empty = no cross-origin browser access; required (non-empty) in production so a
  // deploy can't silently ship with the front end blocked.
  CORS_ORIGINS: Joi.string()
    .allow('')
    .default('')
    .custom((value: string, helpers) => {
      try {
        parseCorsOrigins(value);
        return value;
      } catch (err) {
        return helpers.message({ custom: (err as Error).message });
      }
    })
    .when('NODE_ENV', { is: 'production', then: Joi.string().required().invalid('') }),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  // Unpooled connection, read directly by the Prisma CLI (`schema.prisma`'s
  // `directUrl`) for schema-changing commands (`migrate`, `db push`) — never read by
  // the running app itself, so it isn't in `configuration.ts`. Against a plain
  // Postgres instance with no pooler in front of it (e.g. local Docker), this is the
  // same value as DATABASE_URL.
  DATABASE_DIRECT_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .default(''),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().positive().default(30),

  ARGON2_MEMORY_KIB: Joi.number().integer().min(8192).default(19456),
  ARGON2_TIME_COST: Joi.number().integer().min(1).default(2),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),

  EMAIL_VERIFICATION_TTL_MIN: Joi.number().integer().positive().default(10),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  PASSWORD_RESET_TTL_MIN: Joi.number().integer().positive().default(60),
  // Clinician invitation link lifetime. Renamed from ACCOUNT_SETUP_TTL_MIN (plan 0010) so a stale
  // deployed value is ignored rather than silently shortening the invitation.
  ACCOUNT_SETUP_TTL_HOURS: Joi.number().integer().positive().default(72),

  // Required in production: an empty key makes the email service log instead of send,
  // which would silently break verification and password-reset mail.
  RESEND_API_KEY: Joi.string()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().required().invalid('') }),
  EMAIL_FROM: Joi.string().required(),

  // Required in production (real Cloudinary account); local/test run against the
  // Fake media storage service and never need real credentials.
  CLOUDINARY_CLOUD_NAME: Joi.string()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().required() }),
  CLOUDINARY_API_KEY: Joi.string()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().required() }),
  CLOUDINARY_API_SECRET: Joi.string()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().required() }),

  // Number of reverse-proxy hops in front of the app (Express 'trust proxy'), so the rate
  // limiter keys on the real client IP. Must be measured per host — never guessed, never
  // 'true' (spoofable X-Forwarded-For). Required in production; 0 = no proxy.
  TRUST_PROXY_HOPS: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .when('NODE_ENV', { is: 'production', then: Joi.number().integer().min(0).required() }),

  THROTTLE_TTL_SEC: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  // Background jobs (plan 0011). JOBS_ENABLED=false turns off the cron sweep and boot
  // catch-up (tests); the post-commit kick and admin trigger still work.
  JOBS_ENABLED: Joi.boolean().default(true),
  JOBS_SWEEP_CRON: Joi.string().default('0 */10 * * * *'),
  JOBS_VISIBILITY_TIMEOUT_SEC: Joi.number().integer().min(60).default(300),
  JOBS_BATCH_SIZE: Joi.number().integer().min(1).max(100).default(10),
  JOBS_BACKOFF_BASE_SEC: Joi.number().integer().min(1).default(30),
  JOBS_BACKOFF_CAP_SEC: Joi.number().integer().min(1).default(3600),
  JOBS_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  JOBS_SUCCEEDED_RETENTION_DAYS: Joi.number().integer().min(1).default(14),
  JOBS_SHUTDOWN_GRACE_SEC: Joi.number().integer().min(0).default(20),
  JOBS_KICK_MODE: Joi.string().valid('async', 'inline').default('async'),
  // Optional shared secret for the machine trigger POST /v1/jobs/run-due. Unset = route
  // disabled (404). When set it must be a long random value.
  JOBS_RUN_TOKEN: Joi.string().min(32).allow('').default(''),

  // A media upload ticket still PENDING after this long is expired to FAILED (plan 0011 B-8).
  // Generous so a slow upload is never failed under the parent.
  MEDIA_PENDING_TTL_HOURS: Joi.number().integer().min(1).default(24),

  SENTRY_DSN: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  // Seed-only — not required for the app to boot. `tlds: false` so dev-only
  // addresses like `admin@neuronest.local` (no IANA TLD) are accepted.
  ADMIN_EMAIL: Joi.string().email({ tlds: false }).allow('').default(''),
  ADMIN_PASSWORD: Joi.string().allow('').default(''),
  ADMIN_NAME: Joi.string().allow('').default('NeuroNest Admin'),
});

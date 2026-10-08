import * as Joi from 'joi';
import { parseCorsOrigins } from './cors';

/** `provider:model` for the three providers the AI module can load. */
const AI_MODEL_PATTERN = /^(google|anthropic|openai):[A-Za-z0-9._-]+$/;

const AI_PROVIDER_KEYS: Record<string, string> = {
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/**
 * Cross-field AI rules (plan 0018). Only enforced when `AI_ENABLED=true`:
 * - every provider named in `AI_MODEL` / `AI_FALLBACK_MODEL` needs its API key;
 * - gate G1: production may not run AI unless the operator attests the provider account is
 *   cleared for real child-related data (`AI_ALLOW_REAL_DATA=true`). The free tier never is.
 */
export function validateAiEnv(env: Record<string, unknown>, helpers: Joi.CustomHelpers): unknown {
  if (env.AI_ENABLED !== true) return env;

  for (const modelKey of ['AI_MODEL', 'AI_FALLBACK_MODEL'] as const) {
    const value = env[modelKey];
    if (typeof value !== 'string' || value === '') continue;
    const keyName = AI_PROVIDER_KEYS[value.split(':')[0]];
    if (!env[keyName]) {
      return helpers.message({
        custom: `${keyName} is required when AI_ENABLED=true and ${modelKey} uses that provider`,
      });
    }
  }

  if (env.NODE_ENV === 'production' && env.AI_ALLOW_REAL_DATA !== true) {
    return helpers.message({
      custom:
        'AI_ENABLED=true in production requires AI_ALLOW_REAL_DATA=true: set it only after the AI ' +
        'provider account is on terms that forbid training on inputs and legal has approved ' +
        '(plan 0018 gates G1/G2). The free tier does not qualify.',
    });
  }
  return env;
}

/**
 * Cross-field email rules. Production only (dev/test degrade to logging the message):
 * - the selected provider must have its credentials (an empty key/password makes the service log
 *   instead of send, silently breaking verification and password-reset mail).
 */
export function validateEmailEnv(
  env: Record<string, unknown>,
  helpers: Joi.CustomHelpers,
): unknown {
  if (env.NODE_ENV !== 'production') return env;

  const required =
    env.EMAIL_PROVIDER === 'smtp' ? ['SMTP_USER', 'SMTP_PASSWORD'] : ['RESEND_API_KEY'];
  for (const key of required) {
    if (!env[key]) {
      return helpers.message({
        custom: `${key} is required in production when EMAIL_PROVIDER=${String(env.EMAIL_PROVIDER)}`,
      });
    }
  }

  return env;
}

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

  // Which EmailService implementation to bind. Credentials for the selected provider (and a
  // non-placeholder EMAIL_FROM) are enforced in production by `validateEmailEnv` below.
  EMAIL_PROVIDER: Joi.string().valid('resend', 'smtp').default('resend'),
  RESEND_API_KEY: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().required(),
  // SMTP (EMAIL_PROVIDER=smtp). Defaults target Gmail with an App Password (implicit TLS on 465).
  SMTP_HOST: Joi.string().default('smtp.gmail.com'),
  SMTP_PORT: Joi.number().port().default(465),
  // Unset = implicit TLS only on 465 (derived in configuration.ts); set to force either mode.
  SMTP_SECURE: Joi.boolean(),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),

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

  // AI foundation (plan 0018). Off by default; the cross-field rules at the bottom of this schema
  // (provider keys, production real-data gate) only apply when AI_ENABLED=true.
  AI_ENABLED: Joi.boolean().default(false),
  AI_MODEL: Joi.string().pattern(AI_MODEL_PATTERN).default('google:gemini-3.5-flash-lite'),
  AI_FALLBACK_MODEL: Joi.string().pattern(AI_MODEL_PATTERN).allow('').default(''),
  GOOGLE_GENERATIVE_AI_API_KEY: Joi.string().allow('').default(''),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  AI_ALLOW_REAL_DATA: Joi.boolean().default(false),
  AI_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(10000),
  AI_MAX_OUTPUT_TOKENS: Joi.number().integer().min(50).max(8192).default(700),
  AI_USER_DAILY_LIMIT: Joi.number().integer().min(1).default(3),
  AI_DAILY_REQUEST_BUDGET: Joi.number().integer().min(1).default(400),
  AI_OUTPUT_RETENTION_DAYS: Joi.number().integer().min(1).default(14),

  SENTRY_DSN: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  // Seed-only — not required for the app to boot. `tlds: false` so dev-only
  // addresses like `admin@neuronest.local` (no IANA TLD) are accepted.
  ADMIN_EMAIL: Joi.string().email({ tlds: false }).allow('').default(''),
  ADMIN_PASSWORD: Joi.string().allow('').default(''),
  ADMIN_NAME: Joi.string().allow('').default('NeuroNest Admin'),
})
  .custom(validateEmailEnv)
  .custom(validateAiEnv);

import * as Joi from 'joi';

/**
 * Joi schema for process environment. Applied by `ConfigModule.forRoot({ validationSchema })`
 * so the process fails fast at boot when a required variable is missing or malformed,
 * rather than at the first request that needs it.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  APP_WEB_URL: Joi.string().uri().required(),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().positive().default(30),

  ARGON2_MEMORY_KIB: Joi.number().integer().min(8192).default(19456),
  ARGON2_TIME_COST: Joi.number().integer().min(1).default(2),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),

  EMAIL_VERIFICATION_TTL_MIN: Joi.number().integer().positive().default(10),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  PASSWORD_RESET_TTL_MIN: Joi.number().integer().positive().default(60),
  ACCOUNT_SETUP_TTL_MIN: Joi.number().integer().positive().default(60),

  RESEND_API_KEY: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().required(),

  THROTTLE_TTL_SEC: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  SENTRY_DSN: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  // Seed-only — not required for the app to boot. `tlds: false` so dev-only
  // addresses like `admin@neuronest.local` (no IANA TLD) are accepted.
  ADMIN_EMAIL: Joi.string()
    .email({ tlds: false })
    .allow('')
    .default(''),
  ADMIN_PASSWORD: Joi.string().allow('').default(''),
  ADMIN_NAME: Joi.string().allow('').default('NeuroNest Admin'),
});

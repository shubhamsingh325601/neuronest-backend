import { Throttle } from '@nestjs/throttler';

/**
 * Stricter rate limit for the auth surface (brute-force / enumeration defence).
 * Fixed rather than env-driven: decorators are evaluated at import time, before the
 * config layer is available. The generous global limit stays configurable via
 * THROTTLE_TTL_SEC / THROTTLE_LIMIT.
 */
export const AUTH_RATE_LIMIT = { limit: 5, ttl: 60_000 } as const;

/** Apply to every controller under /v1/auth. Overrides the global `default` throttler. */
export const AuthThrottle = () => Throttle({ default: AUTH_RATE_LIMIT });

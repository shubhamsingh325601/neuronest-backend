import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Parses the comma-separated `CORS_ORIGINS` env value into a de-duplicated list of
 * browser origins.
 *
 * Strict on purpose: a browser's `Origin` header is exactly `scheme://host[:port]` (no
 * path, no trailing slash, default ports omitted, host lowercased) and is compared
 * verbatim, so an entry that isn't already in that canonical form would silently never
 * match. Rather than quietly "fixing" it, reject it at boot with the canonical form.
 * Wildcards are not valid origins and are rejected too.
 *
 * @throws Error naming the offending entry and its canonical form.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    let canonical: string | null = null;
    try {
      const url = new URL(entry);
      if (url.protocol === 'http:' || url.protocol === 'https:') canonical = url.origin;
    } catch {
      // not a URL at all (e.g. "*" or "localhost:3000") — handled below
    }

    if (canonical === null) {
      throw new Error(
        `CORS_ORIGINS entry "${entry}" is not a valid http(s) origin (expected e.g. "https://app.example.com")`,
      );
    }
    if (canonical !== entry) {
      throw new Error(
        `CORS_ORIGINS entry "${entry}" is not in canonical origin form — use "${canonical}" (no path, no trailing slash, lowercase host, no default port)`,
      );
    }
  }

  return [...new Set(entries)];
}

/**
 * Response headers a cross-origin page may read. Browsers hide everything outside the
 * CORS-safelisted set unless listed here: the request id (support/debugging) and the
 * `@nestjs/throttler` rate-limit headers (so a client can honour `Retry-After` on 429).
 */
const EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

/**
 * CORS options for `app.enableCors()`.
 *
 * - `origin` is an exact-match allow-list. Matching origins are echoed back (never `*`)
 *   with `Vary: Origin`. Requests without an `Origin` header (curl, mobile apps,
 *   server-to-server, same-origin) aren't subject to CORS and pass through untouched.
 *   An empty list means no cross-origin browser access.
 * - `credentials` is left off: auth is a bearer token in the `Authorization` header and
 *   the API sets no cookies, so credentialed CORS isn't needed.
 * - `allowedHeaders` is left unset so the `cors` middleware reflects whatever the
 *   preflight asks for — safe because the origin is already allow-listed.
 */
export function buildCorsOptions(origins: readonly string[]): CorsOptions {
  return {
    origin: [...origins],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: 600,
  };
}

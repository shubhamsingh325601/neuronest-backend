import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Token helpers shared by auth features.
 *
 * - Refresh tokens and password-reset tokens are opaque high-entropy random strings.
 *   Only their SHA-256 hash is stored; the plaintext is returned to the caller once.
 * - Email-verification codes are 6-digit numbers (low entropy on purpose — usable),
 *   protected by a short TTL + an attempt counter at the call site.
 */

/** URL-safe opaque token, 32 bytes of entropy by default. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Zero-padded 6-digit numeric code, uniformly random. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

/** Stable hash for at-rest storage and lookups. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

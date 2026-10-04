import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { sha256 } from '@common/crypto/token.util';

type ThrottleRequest = {
  user?: { id?: string };
  body?: Record<string, unknown>;
};

/**
 * Rate limiting WITHOUT client IPs (decision 2026-10-04): behind Vercel / Render /
 * Hostinger the real client IP depends on each platform's proxy chain, so the limiter keys
 * on what the request itself identifies instead:
 *   1. the authenticated user id (registered after `JwtAuthGuard`, so `request.user` is set);
 *   2. else the `email` in the body (login, signup, forgot-password, verify, resend);
 *   3. else a hash of the `token` / `refreshToken` in the body (reset, setup, refresh, logout).
 * A request with none of these (e.g. health probes) is not limited at all.
 *
 * Trade-off, accepted for now: one account's login/reset attempts are capped (brute force
 * on a single account), but one client spraying many different emails is not. Add an
 * IP-based layer later if real traffic needs it.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ThrottleRequest>();
    return trackerKey(request) === null;
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return trackerKey(req as ThrottleRequest) ?? 'unkeyed';
  }
}

/** Exported for unit tests. */
export function trackerKey(req: ThrottleRequest): string | null {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  const body = req.body ?? {};
  const email = body['email'];
  if (typeof email === 'string' && email.trim()) {
    return `email:${email.trim().toLowerCase().slice(0, 254)}`;
  }
  for (const field of ['token', 'refreshToken']) {
    const value = body[field];
    if (typeof value === 'string' && value) {
      return `token:${sha256(value)}`;
    }
  }
  return null;
}

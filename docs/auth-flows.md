# Auth flows

All routes are `POST` under `/v1/auth/` unless noted. Emails are normalised
`.toLowerCase().trim()` on the way in. No endpoint ever confirms whether an address has
an account (see [rbac.md](rbac.md) and each flow's "enumeration" note).

## Lifetimes & knobs

| Secret | Shape | TTL | Limits | Env |
|--------|-------|-----|--------|-----|
| Access token | Signed JWT (`@nestjs/jwt`) | `JWT_ACCESS_TTL` (default `15m`) | — | `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` |
| Refresh token | Opaque 32-byte random, SHA-256 at rest | `REFRESH_TOKEN_TTL_DAYS` (default `30`) | rotated every refresh; reuse ⇒ family revoked | `REFRESH_TOKEN_TTL_DAYS` |
| Email verification code | 6-digit numeric, SHA-256 at rest | `EMAIL_VERIFICATION_TTL_MIN` (default `10`) | `EMAIL_VERIFICATION_MAX_ATTEMPTS` (default `5`), then consumed | `EMAIL_VERIFICATION_*` |
| Password reset token | Opaque 32-byte random, SHA-256 at rest | `PASSWORD_RESET_TTL_MIN` (default `60`) | single-use | `PASSWORD_RESET_TTL_MIN` |
| Account-setup token | Opaque 32-byte random, SHA-256 at rest | `ACCOUNT_SETUP_TTL_MIN` (default `60`) | single-use | `ACCOUNT_SETUP_TTL_MIN` |

Issuing a new verification / reset / account-setup token for a user+type first
**consumes any outstanding one** of that type. Every `/v1/auth/*` route is additionally rate-limited to 5 req / 60 s
(`@AuthThrottle()`).

## Signup → verify → login → refresh → logout

```
CLIENT                          API                                   DB / EMAIL
  │  POST /auth/signup           │                                        │
  │  {name,email,password}       │                                        │
  │─────────────────────────────>│  email exists & verified?  ──> 409 EMAIL_ALREADY_REGISTERED
  │                              │  email exists, unverified? ──> re-issue code, 201
  │                              │  else: hash pw (argon2id), create User │
  │                              │        role=PARENT status=ACTIVE       │
  │                              │        emailVerifiedAt=null            │
  │                              │  issue 6-digit code, consume prior ───>│ verification_tokens
  │                              │  EmailService.sendEmailVerificationCode│──> email (or dev log)
  │<─────────────────────────────│  201 { id, email }                    │
  │                              │                                        │
  │  POST /auth/verify-email     │                                        │
  │  {email, code}               │                                        │
  │─────────────────────────────>│  unknown email ─────> 400 INVALID_VERIFICATION_CODE (generic)
  │                              │  already verified ──> 200 {verified:true} (idempotent)
  │                              │  newest unconsumed/unexpired code:     │
  │                              │    attempts >= max ──> consume, 400 VERIFICATION_ATTEMPTS_EXCEEDED
  │                              │    mismatch ────────> attempts++, 400 INVALID_VERIFICATION_CODE
  │                              │    match ───────────> consume, set User.emailVerifiedAt = now
  │<─────────────────────────────│  200 { verified: true }               │
  │                              │                                        │
  │  POST /auth/login            │                                        │
  │  {email, password}           │                                        │
  │─────────────────────────────>│  no user / bad pw ──> 401 INVALID_CREDENTIALS (single code)
  │                              │  emailVerifiedAt null ──> 403 EMAIL_NOT_VERIFIED
  │                              │  status != ACTIVE ─────> 403 ACCOUNT_NOT_ACTIVE
  │                              │  set lastLoginAt = now                 │
  │                              │  issue access JWT + opaque refresh ───>│ refresh_tokens (hash)
  │<─────────────────────────────│  200 SessionTokensDto                  │
  │                              │  { accessToken, refreshToken,          │
  │                              │    tokenType:'Bearer', expiresIn }     │
  │                              │                                        │
  │  POST /auth/refresh          │                                        │
  │  {refreshToken}              │                                        │
  │─────────────────────────────>│  hash unknown ─────> 401 INVALID_REFRESH_TOKEN
  │                              │  revoked & reused ─> revoke ALL user tokens, 401
  │                              │  expired ──────────> 401 INVALID_REFRESH_TOKEN
  │                              │  valid: revoke presented row,          │
  │                              │         issue fresh access + refresh   │
  │<─────────────────────────────│  200 SessionTokensDto (new pair)       │
  │                              │                                        │
  │  POST /auth/logout           │                                        │
  │  {refreshToken}              │  revoke matching unrevoked row(s)      │
  │─────────────────────────────>│  (idempotent — unknown token is a no-op)
  │<─────────────────────────────│  204 No Content                       │
```

Authenticated requests carry `Authorization: Bearer <accessToken>`. `JwtAuthGuard`
verifies the signature and expiry, then re-reads the account from the database and
rejects any user whose current `status` is not `ACTIVE` (or whose row is gone).

`POST /auth/resend-verification` `{email}` always returns **202**, whether or not the
address exists or is already verified — it only actually sends when the user exists and
is unverified.

## Forgot password → reset

```
CLIENT                          API                                   DB / EMAIL
  │  POST /auth/forgot-password  │                                        │
  │  {email}                     │  unknown email ──> (still) 202         │
  │─────────────────────────────>│  known: issue opaque reset token,     │
  │                              │  consume prior, build link:           │
  │                              │  ${APP_WEB_URL}/reset-password?token=  │──> email (or dev log)
  │<─────────────────────────────│  202 Accepted (always)                │
  │                              │                                        │
  │  POST /auth/reset-password   │                                        │
  │  {token, newPassword}        │  token unknown/expired/consumed ──> 400 INVALID_RESET_TOKEN
  │─────────────────────────────>│  valid: consume token,                │
  │                              │  hash newPassword (argon2id),         │
  │                              │  update User.passwordHash,            │
  │                              │  revokeAllForUser  ──────────────────>│ every refresh token revoked
  │<─────────────────────────────│  200 { reset: true }                  │
```

The `forgot-password` 202-always response is the enumeration guard. Reset invalidates
every existing session, so a stolen-then-reset account logs the attacker out everywhere.

## Account setup (invited clinician)

When an admin approves a `ClinicianApplication`, a `User` is provisioned with
`role=CLINICIAN`, `status=INVITED`, `passwordHash=null`, `emailVerifiedAt=null` (see
[rbac.md](rbac.md) and the Phase 3 plan). `INVITED` is not `ACTIVE`, so the account
cannot log in or refresh until setup completes.

```
CLIENT                          API                                   DB / EMAIL
  │  (admin approves application)│  create User INVITED, passwordHash=null│
  │                              │  issue opaque ACCOUNT_SETUP token,     │
  │                              │  consume prior, build link:            │
  │                              │  ${APP_WEB_URL}/complete-account-setup?token=  │──> email (or dev log)
  │                              │                                        │
  │  POST /auth/complete-account-setup                                    │
  │  {token, password}           │  token unknown/expired/consumed ──> 400 INVALID_SETUP_TOKEN
  │─────────────────────────────>│  valid: consume token,                │
  │                              │  hash password (argon2id),            │
  │                              │  User.passwordHash = hash,            │
  │                              │  User.status = ACTIVE,                │
  │                              │  User.emailVerifiedAt = now            │
  │<─────────────────────────────│  200 { complete: true }               │
```

No sessions are revoked — an `INVITED` account has never authenticated. The setup link
is sent to the application's email, so completing it doubles as email verification.

## Deactivate (self-exclusion)

```
CLIENT (bearer)                 API
  │  POST /v1/users/me/deactivate  (@Auth('user:deactivate:self'))
  │──────────────────────────────>│  User.status = DEACTIVATED
  │                               │  User.selfExcludedAt = now
  │                               │  revokeAllForUser  (all sessions dropped)
  │<──────────────────────────────│  200 { status:'DEACTIVATED', selfExcludedAt }
  │
  │  any authed request (later)   │──> 403 ACCOUNT_NOT_ACTIVE  (guard re-checks DB status)
  │  POST /auth/login  (later)     │──> 403 ACCOUNT_NOT_ACTIVE
```

Reversal is admin-only and lands in a later phase. `selfExcludedAt` is stored separately
from `updatedAt` so the "user chose to leave" timestamp survives any later record edits.

**Immediate cut-off:** deactivation takes effect on the user's very next request.
`JwtAuthGuard` verifies the token signature and then re-reads the account's `status`
from the database (indexed PK lookup), so a `DEACTIVATED` — or admin-`SUSPENDED` —
user is rejected with 403 `ACCOUNT_NOT_ACTIVE` even while their existing access token
is otherwise still within its `JWT_ACCESS_TTL`. Refresh tokens are also revoked, so no
new access token can be minted, and re-login returns 403.

## Error codes

Every failure is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details,
served as `Content-Type: application/problem+json`:

```json
{
  "type": "https://docs.neuronest.dev/problems/invalid-credentials",
  "title": "Invalid Credentials",
  "status": 401,
  "detail": "Email or password is incorrect.",
  "instance": "/v1/auth/login",
  "code": "INVALID_CREDENTIALS",
  "requestId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "timestamp": "2026-08-30T00:00:00.000Z"
}
```

- `type` — stable URI built from `code` (kebab-case). It need not resolve to a page.
- `title` — one static phrase per `code` (Start Case of the code).
- `status` / `detail` / `instance` — the HTTP status, the human-readable message, and
  the request path.
- `code`, `requestId`, `timestamp` — extension members; unchanged from before.
- Validation failures (`VALIDATION_ERROR`) add `errors: string[]` — the individual
  field messages; `detail` is that list joined with `"; "`.

The `code` values, status codes, and every flow's behaviour are exactly as documented
above — only the envelope changed. Stable `code` values used by these flows:

`EMAIL_ALREADY_REGISTERED` · `INVALID_VERIFICATION_CODE` · `VERIFICATION_ATTEMPTS_EXCEEDED` ·
`INVALID_CREDENTIALS` · `EMAIL_NOT_VERIFIED` · `ACCOUNT_NOT_ACTIVE` · `INVALID_REFRESH_TOKEN` ·
`INVALID_RESET_TOKEN` · `INVALID_SETUP_TOKEN` · `VALIDATION_ERROR` (DTO) ·
`RATE_LIMITED` (throttler) · `UNAUTHORIZED` (missing/invalid bearer).

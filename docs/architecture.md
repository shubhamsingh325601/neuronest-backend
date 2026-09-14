# Architecture

## Shape: modular monolith

One deployable Nest application. The domain is split into **modules** (`src/modules/<domain>/`),
and cross-cutting infrastructure lives in `src/common/<concern>/`. There is no separate
service mesh, no message bus, no per-module database. When a domain genuinely needs to
split out later, the module boundary is already the seam.

Phase 1 modules:

| Module | Responsibility |
|--------|----------------|
| `auth` | signup, email verification, login, refresh, logout, forgot/reset password |
| `users` | `GET /users/me`, self-deactivation |
| `clinicians` | public clinician-**application** submission (first feature of the clinician domain) |
| `health` | liveness + DB probe |

`common` modules (each `@Global` where it needs DI): `PrismaModule`, `EmailModule`,
`CryptoModule`, `AuthzModule`, `LoggingModule`, plus config, filters, throttler config,
and OpenAPI wiring.

## Layout: folder per use-case

Inside a module there is **no controller/service/repository layering**. Instead, one
folder per use-case:

```
src/modules/auth/
  auth.module.ts
  shared/                         # helpers used by >1 feature in this module
    refresh-token.service.ts
    verification-token.service.ts
    session-tokens.dto.ts
  features/
    signup/
      signup.controller.ts
      signup.service.ts
      signup.service.spec.ts
      dto/signup.dto.ts
    login/
      ...
```

Rationale: a use-case is the unit people actually work on. Keeping its controller,
service, DTOs, and test in one folder means a change touches one directory, and the
folder list doubles as a feature list. Prisma **is** the repository layer — wrapping it
in hand-written repositories buys nothing this phase.

Cross-feature helpers for a module go in `modules/<domain>/shared/`. Anything shared
across modules is `common` infrastructure.

## API versioning

NestJS URI versioning, `defaultVersion: '1'` (`main.ts`). Every domain route is under
`/v1/…`. Exceptions:

- `GET /health` is also exposed **version-neutral** at `/health` (`HealthAliasController`,
  `@ApiExcludeController`) so uptime monitors have a path that never moves. The
  versioned `GET /v1/health` is the one documented.
- `/docs` and `/openapi.json` are mounted with `app.use(...)` outside the Nest router,
  so they are unversioned.

## Request lifecycle

```
request
  │
  ├─ ThrottlerGuard        (APP_GUARD #1) — rate limit; @AuthThrottle() tightens /v1/auth/*
  ├─ JwtAuthGuard          (APP_GUARD #2) — authn: verify access token, then re-read the
  │                                          account and reject non-ACTIVE / deleted
  │                                          users; @Public() routes skip this
  ├─ PermissionsGuard      (APP_GUARD #3) — authz: role → permission check for @Auth(...) /
  │                                          @RequirePermissions() routes
  ├─ ValidationPipe        (global) — whitelist + forbidNonWhitelisted + transform on the DTO
  ├─ Controller handler → Service
  │      ownership checks ("acting on your own account") happen inline in the service
  │
  └─ AllExceptionsFilter   (global) — normalises every throw to one RFC 9457
         `application/problem+json` shape:
         { type, title, status, detail, instance, code, requestId, timestamp }
         (+ errors[] for validation failures). `code` / `requestId` / `timestamp` are
         extension members; `type` is a stable URI built from `code`, `title` a static
         phrase per code.
         HttpException passes through (honours an optional `code`);
         Prisma P2002 → 409, P2025 → 404; anything else → 500 + Sentry.captureException
```

Guards run in registration order (`app.module.ts` `providers`): rate-limit → authenticate
→ authorize.

## Why in-house JWT (not Auth0 / Cognito / Passport strategies)

- **Refresh-token semantics we control.** Opaque 32-byte refresh tokens, SHA-256 hash at
  rest, rotated every refresh, with reuse detection that revokes the whole token family.
  That behaviour is a product decision, not something to bend a third party around.
- **No per-seat identity-provider cost** for a consumer product with a large parent base.
- **Data residency / audit** stay in our Postgres.
- The surface is small and well-trodden: argon2id password hashing, short-lived signed
  access tokens, a refresh-token table. `@nestjs/jwt` signs/verifies the access token;
  everything else is ~three services (`AccessTokenService`, `RefreshTokenService`,
  `VerificationTokenService`).

Documented upgrade path: if federated login or enterprise SSO becomes a requirement, the
`auth` module is the integration point — the guards and the `AuthenticatedUser` shape
stay, only token issuance changes.

## Configuration & boot

`ConfigModule.forRoot({ isGlobal, load: [configuration], validationSchema })`. The Joi
`envValidationSchema` runs at boot — a missing or malformed variable crashes the process
immediately rather than at the first request that needs it. Typed access via
`ConfigService<AppConfig, true>` and namespaced slices (`config.get('jwt', { infer: true })`).
`.env.example` lists every variable with no secrets.

## Observability

- **Logging** — `nestjs-pino`; the per-request `id` is reused as `requestId` in the error
  shape; token/secret keys are redacted; `pino-pretty` only in development.
- **Sentry** — `src/instrument.ts` is imported first in `main.ts`; `SentryModule.forRoot()`
  in `AppModule`; the exception filter reports every 5xx. No-op when `SENTRY_DSN` is unset.

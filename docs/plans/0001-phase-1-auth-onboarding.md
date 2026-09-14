# Plan 0001 — Phase 1: Auth & Onboarding Foundation

Status: **DONE** (verified end-to-end 2026-08-30 — build, migrate, seed, runtime smoke
test, and both test suites all green; see §7)
Owner: solo dev
Last updated: 2026-08-30

> This file is the single source of truth for Phase 1. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top
> to bottom before touching code.

---

## 1. Context

NeuroNest is an AI-assisted therapy product for children with autism / ADHD (and
similar profiles). Parents/guardians manage a child's care; clinicians are brought in
later under a subscription model; admins oversee everything.

Phase 1 ships **only** the account + onboarding foundation and the cross-cutting
infrastructure that is cheap now and expensive to retrofit. Out of scope and **not to
be scaffolded**: video upload, AI engine, doctor app, admin panel UI, billing,
RAG/chat.

Stack: **NestJS 11 (TypeScript) · PostgreSQL 16 via Prisma 6 · in-house JWT auth ·
modular monolith**, one Nest module per domain, and inside each module a folder per
use-case (controller + service + DTOs + spec) — **not** classic
controller/service/repository layers. No DDD ceremony.

---

## 2. Locked decisions (do not relitigate)

| # | Decision | Notes |
|---|----------|-------|
| D1 | **API versioning**: NestJS URI versioning, `defaultVersion: '1'`. Every route under `/v1/`. `/health` also exposed version-neutral at `/health`. `/docs` + `/openapi.json` are unversioned. | done |
| D2 | **Password hashing**: argon2id, params from env (`ARGON2_*`). | done — `common/crypto/password.service.ts` |
| D3 | **Refresh tokens** live in a table. Opaque 32-byte random strings, only the SHA-256 hash stored. Rotated on every `/auth/refresh`. **Reuse detection**: presenting a revoked token revokes the user's entire token family. | done — `modules/auth/shared/refresh-token.service.ts` |
| D4 | **Email verification** = 6-digit numeric code the user types. `POST /v1/auth/verify-email { email, code }`. TTL 10 min, max 5 attempts, rate-limited resend via `POST /v1/auth/resend-verification`. | done |
| D5 | **Password reset** = tokenised link. `forgot-password` emails `${APP_WEB_URL}/reset-password?token=<opaque 32-byte>`; that page calls `POST /v1/auth/reset-password { token, newPassword }`. Single-use, 1-hour TTL, hashed at rest. Reset revokes all refresh tokens. | done |
| D6 | **One `VerificationToken` table** backs both D4 and D5. Columns: `type` (EMAIL_VERIFICATION \| PASSWORD_RESET), `channel` (EMAIL), `tokenHash`, `attempts`, `expiresAt`, `consumedAt`. Extensible to MFA / login step-up later with no schema rewrite. | done — added on top of the brief's data model |
| D7 | **RBAC** = static role→permission map in code (`common/authz/permissions.ts`), `JwtAuthGuard` (authn, rejects non-ACTIVE) + `PermissionsGuard` (authz) registered globally, decorators `@Public()`, `@Auth(...perms)`, `@RequirePermissions()`, `@CurrentUser()`. Ownership ("acting on your own account") is checked inline in services. **No dynamic RBAC tables this phase.** Documented upgrade path: feed the same map into `@casl/ability` when rules become conditional — no migration needed. | done |
| D8 | **Rate limiting**: `@nestjs/throttler` global `default` throttler (env `THROTTLE_TTL_SEC` / `THROTTLE_LIMIT`, generous). Every `/v1/auth/*` controller adds `@AuthThrottle()` = fixed 5 req / 60 s (`common/throttler/throttle.config.ts`). Fixed rather than env because decorators evaluate before config loads. | done |
| D9 | **Global exception filter** with one error shape: `{ statusCode, error, message, code, path, timestamp, requestId }`. `HttpException` passes through honouring an optional `code`; Prisma P2002→409, P2025→404; anything else →500 + `Sentry.captureException`. | done — `common/filters/all-exceptions.filter.ts` + `common/dto/error-response.dto.ts` |
| D10 | **Validation** via class-validator/class-transformer on every DTO; global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`. | done |
| D11 | **Config** via `@nestjs/config`, `isGlobal`, `load: [configuration]`, Joi `validationSchema` (fail fast at boot). Typed `AppConfig` accessor. `.env.example` committed with every var named, no secrets. | done |
| D12 | **Structured logging** via `nestjs-pino`; per-request `id` reused as `requestId`; secrets/tokens redacted; `pino-pretty` only in development. | done |
| D13 | **Sentry** via `@sentry/nestjs`; `src/instrument.ts` imported first in `main.ts`; no-op when `SENTRY_DSN` unset. | done |
| D14 | **Email** behind an abstract `EmailService` (DI token); real `ResendEmailService` implemented (`resend` SDK). When `RESEND_API_KEY` is unset it logs the message instead of sending, so flows stay testable locally. Tests override with an in-memory fake. | done |
| D15 | **OpenAPI**: `@nestjs/swagger` CLI plugin enabled in `nest-cli.json` (`introspectComments`, `classValidatorShim`). Document built once at boot from live code (no committed spec file). Served raw at `/openapi.json` and via **Scalar** (`@scalar/nestjs-api-reference`) at `/docs`. Explicit `operationId` on every route via `@ApiOperation`. | done |
| D16 | **Doc-drift test**: `test/docs.e2e-spec.ts` fetches `/openapi.json` and asserts the exact set of `(method, path, operationId)` tuples. Renaming/removing a route without updating the list fails the build. | done |
| D17 | **Docker Compose** for local Postgres only (app runs with `npm run start:dev`). | done — `docker-compose.yml` |
| D18 | **Seed script** (not an endpoint): `prisma/seed.ts`, `npm run db:seed`, idempotent `upsert` of the first ADMIN from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`. | done |
| D19 | **Tests**: unit spec next to each service (Prisma + Email mocked); e2e for signup→verify→login→refresh→logout, for the deactivate flow, for clinician application submission, and the docs test. | unit done (25 passing); e2e written, not yet run (needs Docker Postgres) |
| D20 | **Plans** live in `docs/plans/NNNN-*.md` with `docs/plans/README.md` index + `TEMPLATE.md`. Root `plan.md` is a one-line pointer. | this file exists; index/template/pointer pending |

### New decisions from review round 2 (2026-08-30)

| # | Decision |
|---|----------|
| D21 | **Path-alias imports, not relative.** All intra-repo imports use aliases. Add to `tsconfig.json` (`baseUrl: "."`, `paths`), `nest-cli.json` is fine as-is (tsc handles it), `jest.config.ts` + `test/jest-e2e.config.ts` need matching `moduleNameMapper`, and add `tsconfig-paths` register for `ts-node` (seed script) if needed. Aliases: `@app/*` → `src/*`, `@common/*` → `src/common/*`, `@modules/*` → `src/modules/*`, `@test/*` → `test/*`. **Every file already written uses relative imports and must be refactored.** |
| D22 | **Rename module `clinician-applications` → `clinicians`.** Rationale: the module is the clinician domain, not one form. "Application"/"interest" is just its first feature; later it holds clinician-facing things gated by the subscription model (insights, reports, caseload/child management, etc.). New shape: `src/modules/clinicians/clinicians.module.ts` + `src/modules/clinicians/features/interest/` (public interest capture → `ClinicianApplication` lead row). Keep the Prisma model name `ClinicianApplication` (it is the lead record); only the Nest module/folder is renamed. operationId stays `clinicianApplicationsApply` OR becomes `clinicianInterestSubmit` — **pick `clinicianInterestSubmit` and update `docs.e2e-spec.ts`**. Route stays `POST /v1/clinician-applications` (public landing-page contract) unless there's a reason to move it; if renamed to `/v1/clinicians/interest`, update the doc test and note it as a deviation. Default: keep the route path, rename module + operationId. |
| D23 | **Write `README.md` + `docs/` skeleton + `AGENTS.md` + `CLAUDE.md` FIRST next session**, before the refactor. They were skipped this session and should not have been. |

### New decisions from review round 3 (2026-08-30, during Step E verification)

| # | Decision |
|---|----------|
| D24 | **`JwtAuthGuard` re-reads account status from the DB every request** (refines D7). The first e2e run surfaced that a claims-only status check let a `DEACTIVATED` user keep using an already-issued access token until it expired (~15 min). The guard now does an indexed PK lookup on `User` after verifying the token, rejecting a missing row (`INVALID_TOKEN`) or non-`ACTIVE` status (`ACCOUNT_NOT_ACTIVE`), and populates `request.user` from that fresh row. Cost: one indexed query per authenticated request. The stateless *refresh*-token model (D3) is unchanged. |
| D25 | **`ADMIN_EMAIL` Joi validation uses `email({ tlds: false })`.** The default IANA-TLD check rejected the dev-convention address `admin@neuronest.local`, crashing boot. Seed-only var; loosening the TLD check is harmless. |
| D26 | **`tsconfig.build.json` gains `"include": ["src/**/*"]`** so `nest build` emits `dist/main.js` at the dist root (root-level `jest.config.ts` / `prisma/seed.ts` were widening the inferred `rootDir` to `dist/src/`). `nest build` already rewrites path aliases to relative `require()`, so `start:prod` needs no extra runtime flag. |
| D27 | **E2E stubs `@scalar/nestjs-api-reference`** (`test/helpers/scalar-stub.ts`, wired via `moduleNameMapper`). Its `@scalar/client-side-rendering` dep is ESM-only and Jest's CJS runtime can't load it; nothing in the e2e suite renders `/docs` (the doc-drift test reads `/openapi.json`, served directly). The real Scalar UI is smoke-tested against the running server in Step E. |

---

## 3. Conventions (apply everywhere)

- **Folder per use-case**: `modules/<domain>/features/<use-case>/` contains
  `<use-case>.controller.ts`, `<use-case>.service.ts`, `dto/`, `<use-case>.service.spec.ts`.
  Cross-feature helpers for a module go in `modules/<domain>/shared/`.
- **Shared infra** is in `src/common/<concern>/` as a `@Global` module where it needs DI
  (`PrismaModule`, `EmailModule`, `CryptoModule`, `AuthzModule`, `LoggingModule`).
- **Imports**: path aliases only (D21). No `../../..`.
- **Controllers**: one `@ApiTags`, explicit `@ApiOperation({ operationId })`, explicit
  `@HttpCode` where not 200/201, `@Public()` or `@Auth(...)` on every handler.
- **Errors**: throw Nest `HttpException` subclasses with an object body
  `{ code: 'STABLE_CODE', message: '...' }`. Never leak account existence — signup on a
  verified email → 409; `resend-verification` / `forgot-password` always 202; login
  failures are a single `INVALID_CREDENTIALS`.
- **Secrets/tokens**: only hashes at rest (`sha256` from `common/crypto/token.util.ts`);
  never log them (pino redaction covers common keys).
- **Email normalisation**: `.toLowerCase().trim()` on every inbound email before use.
- **Tests**: unit tests mock `PrismaService` and `EmailService`; no DB. e2e uses the real
  app with `EmailService` overridden by `FakeEmailService` and a throwaway Postgres DB
  truncated between specs.

---

## 4. Data model (final — `prisma/schema.prisma`, already written)

Enums: `Role {PARENT, CLINICIAN, ADMIN}`, `UserStatus {ACTIVE, SUSPENDED, DEACTIVATED}`,
`ClinicianApplicationStatus {PENDING, REVIEWED, APPROVED, REJECTED}`,
`VerificationTokenType {EMAIL_VERIFICATION, PASSWORD_RESET}`, `VerificationChannel {EMAIL}`.

- **User**: id(uuid), email(unique), passwordHash, name, role(=PARENT), status(=ACTIVE),
  emailVerifiedAt?, lastLoginAt?, selfExcludedAt?, createdAt, updatedAt.
- **RefreshToken**: id, userId→User(cascade), tokenHash(unique), expiresAt, revokedAt?,
  createdAt. `@@index([userId])`.
- **VerificationToken**: id, userId→User(cascade), type, channel(=EMAIL), tokenHash,
  attempts(=0), expiresAt, consumedAt?, createdAt. `@@index([userId, type])`,
  `@@index([tokenHash])`.
- **ClinicianApplication**: id, name, email, context(text), status(=PENDING), createdAt,
  updatedAt. `@@index([status])`. (Model name unchanged by D22.)

No migration has been generated yet (Docker was unavailable this session).

---

## 5. Endpoints (all `/v1` unless noted)

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| POST | /auth/signup | `authSignup` | public | PARENT/ACTIVE/emailVerifiedAt=null; emails 6-digit code; 409 if already verified; resends code if unverified-exists |
| POST | /auth/verify-email | `authVerifyEmail` | public | `{email, code}`; sets emailVerifiedAt; generic error on bad code / unknown email; idempotent if already verified |
| POST | /auth/resend-verification | `authResendVerification` | public | always 202 |
| POST | /auth/login | `authLogin` | public | 200; requires emailVerifiedAt + status ACTIVE; sets lastLoginAt; returns `SessionTokensDto` |
| POST | /auth/refresh | `authRefresh` | public | rotate + reuse-detection; returns `SessionTokensDto` |
| POST | /auth/logout | `authLogout` | public | 204; idempotent |
| POST | /auth/forgot-password | `authForgotPassword` | public | always 202; emails reset link |
| POST | /auth/reset-password | `authResetPassword` | public | `{token, newPassword}`; revokes all sessions |
| GET | /users/me | `usersGetMe` | `@Auth('user:read:self')` | profile projection, no passwordHash |
| POST | /users/me/deactivate | `usersDeactivateMe` | `@Auth('user:deactivate:self')` | status=DEACTIVATED + selfExcludedAt; revokes sessions; login then 403 ACCOUNT_NOT_ACTIVE |
| POST | /clinician-applications | `clinicianApplicationSubmit` (D22 done; route path kept, module + operationId renamed; feature slice later renamed `interest` → `submit-application`) | public | creates PENDING `ClinicianApplication` lead |
| GET | /health  (+ GET /health version-neutral) | `healthCheck` | public | `{status, db, uptime, timestamp}`; 503 if db down |

`SessionTokensDto`: `{ accessToken, refreshToken, tokenType: 'Bearer', expiresIn }`.

---

## 6. Current repo state

**Written & type-clean (`npx tsc --noEmit` passes):** all of `src/**` for the 4 domains
(auth, users, clinicians[as clinician-applications], health) + all `src/common/**` +
`prisma/schema.prisma` + `prisma/seed.ts` + all unit specs + all e2e specs + e2e helpers.

**Verified:** `npx tsc --noEmit` clean; `npx jest` → **25 unit tests pass**.

**NOT done / NOT verified:**
- `npx nest build` (interrupted — never completed once)
- Prisma migration never generated; Postgres never started (Docker Desktop daemon was
  off this session — user must start it)
- e2e suite never run (needs Postgres)
- `/docs` (Scalar) + `/openapi.json` never hit against a running server
- Sentry / pino only wired, never observed at runtime
- Path aliases NOT set up — all imports are relative (D21)
- `clinician-applications` NOT yet renamed to `clinicians` (D22)
- No `README.md`, no `docs/` beyond this file, no `AGENTS.md`, no `CLAUDE.md`, no
  `docs/plans/README.md`, no `docs/plans/TEMPLATE.md`, no root `plan.md` (D23)
- `dotenv` added to package.json deps but `npm install` for it succeeded; a local `.env`
  exists (gitignored) with dev values

**Package versions pinned:** NestJS `^11`, `@nestjs/config@^4.0.4`, `@nestjs/swagger@^11.4`,
`@nestjs/throttler@^6.5`, `prisma`/`@prisma/client@^6.19`, `@scalar/nestjs-api-reference@^1.2.17`,
`@sentry/nestjs@^10.72`, `nestjs-pino@^4.6` + `pino@^9` + `pino-http@^11`, `argon2@^0.45`,
`joi@^17`, `resend@^6`. ESLint flat config v9 + `typescript-eslint`. Node 22 in this env.
(Newer majors exist — NestJS 12, Prisma 7 — deliberately not used to keep peer deps of
throttler/pino/sentry happy. Revisit later.)

**Known code smells to fix during the refactor:**
- ts-jest makes unit tests slow (~55 s each, full type-check per file). Consider
  `isolatedModules: true` in ts-jest transform or swap to `@swc/jest`. Note in AGENTS.md.
- `access-token.service.ts` casts `expiresIn: this.ttl as unknown as number` — jsonwebtoken
  types are stricter than runtime. Acceptable; leave a comment (already there).
- `env.validation.ts` uses `import * as Joi` (style hint only).

---

## 7. Remaining checklist (ordered)

### Step A — docs & scaffolding first (D23)
- [x] `README.md` (root): what NeuroNest is, stack, prerequisites, quickstart
      (`npm install` → `docker compose up -d` → copy `.env.example` → `npm run prisma:migrate`
      → `npm run db:seed` → `npm run start:dev`), where docs live (`/docs` API, `docs/` design),
      script list, license placeholder.
- [x] `docs/README.md` — index linking architecture / schema-decisions / auth-flows / rbac / plans.
- [x] `docs/architecture.md` — modular monolith, feature-folder rationale, URI versioning,
      request lifecycle (guards → pipe → controller → service → filter), why in-house JWT.
- [x] `docs/schema-decisions.md` — every table/field, the `VerificationToken` addition,
      opaque-refresh-token reasoning, index choices.
- [x] `docs/auth-flows.md` — sequences for signup→verify→login→refresh→logout, forgot→reset,
      deactivate; TTLs + revocation rules.
- [x] `docs/rbac.md` — `ROLE_PERMISSIONS` map, guard order, concrete `@casl/ability`
      migration path.
- [x] `docs/plans/README.md` — table: number | title | status | file. Row for 0001 = Active.
- [x] `docs/plans/TEMPLATE.md` — headings: Context / Scope / Data model / Endpoints /
      Cross-cutting / Build order / Verification.
- [x] Root `plan.md` — ~3 lines pointing at `docs/plans/0001-phase-1-auth-onboarding.md`
      and `docs/plans/README.md`.
- [x] `AGENTS.md` (root) — terse: overview; stack; commands; conventions (feature folders,
      one use-case per folder, **path-alias imports**, explicit operationId, DTOs validated,
      no repository layer); testing rules (unit per service + the 4 e2e specs); security notes
      (argon2, hashed tokens, rate-limited auth, no account enumeration, env-only secrets);
      "added beyond brief" dep list; pointers to `docs/` and `plan.md`. No boilerplate.
- [x] `CLAUDE.md` — `ln -s AGENTS.md CLAUDE.md`; if symlink fails on the filesystem, a
      one-line file: `See AGENTS.md — single source of truth for agent instructions.`

### Step B — path aliases (D21)
- [x] `tsconfig.json`: add `"baseUrl": "."`, `"paths": { "@app/*": ["src/*"], "@common/*":
      ["src/common/*"], "@modules/*": ["src/modules/*"], "@test/*": ["test/*"] }`.
      (Re-add `"ignoreDeprecations": "6.0"` if the TS build complains about `baseUrl`.)
- [x] `jest.config.ts` + `test/jest-e2e.config.ts`: `moduleNameMapper` for the same aliases.
- [x] Seed script: ensure `ts-node` resolves aliases — add `-r tsconfig-paths/register` to
      the `db:seed` script, or keep `prisma/seed.ts` on relative imports (it's outside `src`).
- [x] Refactor **every** `src/**` and `test/**` file from relative to alias imports.
- [x] `npx tsc --noEmit` clean, `npx jest` green.

### Step C — clinicians module rename (D22)
- [x] `git mv src/modules/clinician-applications src/modules/clinicians` (and rename files:
      `clinicians.module.ts`; `features/apply` → `features/interest`, `apply.*` →
      `interest.*` / keep `apply` verb on the service method if clearer).
- [x] Update class names: `ClinicianApplicationsModule` → `CliniciansModule`, `ApplyController`
      → `ClinicianInterestController`, `ApplyService` → `ClinicianInterestService` (keep it
      thin; it still just writes a `ClinicianApplication` row).
- [x] operationId → `clinicianInterestSubmit`; update `test/docs.e2e-spec.ts` EXPECTED list
      and the endpoint table in §5 here.
- [x] Keep route path `POST /v1/clinician-applications` (public landing-page contract).
      If you move it to `/v1/clinicians/interest`, record it as a deviation in
      `docs/schema-decisions.md` / this plan and update the doc test.
- [x] Update `app.module.ts` import + rename `test/clinician-application.e2e-spec.ts`.
- [x] Follow-up rename (post-D22): feature slice `features/interest/` → `features/submit-application/`;
      `ClinicianInterestController`/`Service` → `SubmitApplicationController`/`Service`;
      DTOs → `CreateApplicationDto` / `CreateApplicationResponseDto`; operationId
      `clinicianInterestSubmit` → `clinicianApplicationSubmit`. Route path unchanged.
      Going forward each new clinician use-case is its own sibling slice under
      `modules/clinicians/features/` — never a new module.

### Step D — build & DB
- [x] Start Docker Desktop; `docker compose up -d`; confirm `pg_isready`.
- [x] `npx prisma migrate dev --name init` → commit `prisma/migrations/**`.
- [x] `npm run db:seed` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` set → admin row created.
- [x] `npx nest build` → clean.
- [x] `npm run start:dev` → boots, structured logs, no missing-config error.

### Step E — verify at runtime
- [x] `GET http://localhost:3000/health` → `{ status: 'ok', db: 'up' }`.
- [x] Open `http://localhost:3000/docs` — Scalar renders; 11 operations under `/v1`.
- [x] `GET /openapi.json` returns the spec.
- [x] Manual happy path (curl/Scalar): signup → read code from dev log → verify-email →
      login → `GET /v1/users/me` with bearer → refresh → old refresh token rejected → logout.
- [x] `POST /v1/clinician-applications` → 201; row visible in `npx prisma studio`.
- [x] `POST /v1/users/me/deactivate` → login again → 403.
- [x] Hit a `/v1/auth/*` route 6× fast → 429.
- [x] Add `TEST_DATABASE_URL` (throwaway DB) to `.env`; `npm run test:e2e` → all green
      incl. `docs.e2e-spec.ts`. (`global-setup.ts` runs `prisma migrate deploy` on it.)
- [x] `npm test` (unit) still green.
- [x] Force an unhandled error → consistent error JSON shape; Sentry event if DSN set.

### Step F — close-out
- [x] Flip this file's Status to **DONE**; update `docs/plans/README.md`.
- [x] `git add -A && git commit` (first real commit; branch first if needed).
- [x] Short note in `AGENTS.md` of any dep additions made during the refactor.

---

## 8. How to resume

Next session, paste the prompt below. It assumes nothing and points here.

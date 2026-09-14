# AGENTS.md

Instructions for anyone — human or agent — working in this repo. `CLAUDE.md` points here.

## Overview

NeuroNest backend. AI-assisted therapy for children with autism / ADHD. **Phase 1**
ships only the auth + onboarding foundation (see
[`docs/plans/0001-phase-1-auth-onboarding.md`](docs/plans/0001-phase-1-auth-onboarding.md)).
Out of scope this phase: video upload, AI engine, doctor app, admin panel UI, billing,
RAG/chat. Do not scaffold them.

## Stack

NestJS 11 · TypeScript 5.7 · Node 22 · PostgreSQL 16 via Prisma 6 · in-house JWT auth
(argon2id passwords, opaque rotating refresh tokens) · modular monolith.

Pinned deliberately below the latest majors (no NestJS 12 / Prisma 7) to keep
`@nestjs/throttler`, `nestjs-pino`, and `@sentry/nestjs` peer deps happy. Revisit later.

## Commands

| | |
|---|---|
| `npm run start:dev` | Watch dev server (`http://localhost:3000`, docs at `/docs`) |
| `npm run build` | `nest build` |
| `npm test` | Unit tests (no DB) |
| `npm run test:e2e` | E2E (needs `TEST_DATABASE_URL`, throwaway Postgres) |
| `npm run lint` / `npm run format` | ESLint (flat config v9) / Prettier |
| `docker compose up -d` | Local Postgres |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Idempotent first-ADMIN seed (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) |

## Conventions

- **Module per domain** under `src/modules/<domain>/`; shared infra under
  `src/common/<concern>/` (`@Global` where it needs DI).
- **Folder per use-case**: `modules/<domain>/features/<use-case>/` holds
  `<use-case>.controller.ts`, `<use-case>.service.ts`, `dto/`, `<use-case>.service.spec.ts`.
  Cross-feature helpers → `modules/<domain>/shared/`. **No controller/service/repository
  layering. No repository layer — Prisma is it. No DDD ceremony.**
- **Path-alias imports only. No `../` in import paths.** Aliases (`tsconfig.json` `paths`,
  mirrored in both jest configs):
  `@app/*` → `src/*`, `@common/*` → `src/common/*`, `@modules/*` → `src/modules/*`,
  `@test/*` → `test/*`. Same-folder / child imports stay `./relative`.
- **Controllers**: one `@ApiTags`, an explicit `@ApiOperation({ operationId })` on every
  handler, explicit `@HttpCode` where not 200/201, and `@Public()` or `@Auth(...)` on
  every handler.
- **DTOs**: every field validated with class-validator; global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`).
- **Errors**: throw Nest `HttpException` subclasses with an object body
  `{ code: 'STABLE_CODE', message: '...' }`. `AllExceptionsFilter` repackages every throw
  into one RFC 9457 `application/problem+json` envelope (`type`, `title`, `status`,
  `detail`, `instance` + `code` / `requestId` / `timestamp` extension members) — see
  [docs/api-conventions.md](docs/api-conventions.md) and
  [docs/auth-flows.md](docs/auth-flows.md). Never leak account existence — signup on a verified email → 409;
  `resend-verification` / `forgot-password` always 202; login failure is a single
  `INVALID_CREDENTIALS`.
- **Secrets/tokens**: only SHA-256 hashes at rest (`@common/crypto/token.util`). Never
  log them (pino redaction covers common keys).
- **Email**: `.toLowerCase().trim()` every inbound address before use.
- **OpenAPI**: no committed spec file — built at boot from live code. Keep
  `test/docs.e2e-spec.ts`'s `EXPECTED` list in sync with routes (method, path,
  operationId); a mismatch fails the build.

## Testing

- One `*.spec.ts` next to each service. Unit tests mock `PrismaService` and
  `EmailService`; **no DB**.
- E2E specs (`test/*.e2e-spec.ts`): real app, `EmailService` → `FakeEmailService`,
  throwaway Postgres truncated between specs. Suites: `auth.e2e-spec.ts`
  (signup→verify→login→refresh→logout), `deactivate.e2e-spec.ts`,
  `clinician-application.e2e-spec.ts` (public submit + admin review / approve / reject /
  account-setup), `rbac-route-coverage.e2e-spec.ts` (every route gated or `@Public()`),
  `error-shape.e2e-spec.ts` (RFC 9457 envelope), `docs.e2e-spec.ts` (doc-drift guard).
- **ts-jest is slow** (full type-check per file, ~tens of seconds). If it becomes
  painful, set `isolatedModules: true` on the ts-jest transform or move to `@swc/jest`.

## Security notes

argon2id password hashing (params from `ARGON2_*` env) · access tokens are short-lived
signed JWTs · refresh tokens are opaque 32-byte randoms, hashed at rest, rotated every
refresh, reuse revokes the whole family · every `/v1/auth/*` route fixed at 5 req/60 s ·
no account enumeration on any public endpoint · all secrets via env, `.env` gitignored,
`.env.example` committed with no values · password reset & deactivation revoke all
sessions · `JwtAuthGuard` re-reads account status from the DB each request, so
deactivation / suspension takes effect on the next request, not at token expiry.

## Added beyond the original brief

`@nestjs/throttler` (rate limiting) · `nestjs-pino` + `pino-http` + `pino-pretty`
(structured logs) · `@sentry/nestjs` (error reporting) · `@scalar/nestjs-api-reference`
(API docs UI) · `joi` (env validation) · `resend` (email) · one extra table
`VerificationToken` backing email verification, password reset, and clinician account setup ·
`tsconfig-paths` (alias resolution for `ts-node` seed script) · `dotenv` (seed script).

## Build notes

- `nest build` rewrites the `@app`/`@common`/`@modules` aliases to relative `require()`
  paths in emitted JS, so `node dist/main.js` (`start:prod`) works with no extra flags.
  Raw `tsc` does **not** — only build via `nest build`.
- `tsconfig.build.json` sets `"include": ["src/**/*"]` so `dist/main.js` lands at the
  root of `dist/` (without it, root-level `jest.config.ts` / `prisma/seed.ts` widen the
  inferred rootDir and output goes to `dist/src/`).
- The `db:seed` script runs `ts-node -r tsconfig-paths/register` so alias imports would
  resolve there too (the seed itself currently uses none).

## Pointers

- Design docs: [`docs/`](docs/README.md) — architecture, schema decisions, auth flows,
  RBAC, API conventions, adding a permission.
- Plans: [`docs/plans/`](docs/plans/README.md) — one file per phase; the newest
  **Active** row is current.
- Skills: [`.claude/skills/`](.claude/skills/) — repo-local Agent Skills that encode
  these conventions.

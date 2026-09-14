# NeuroNest — Backend

NeuroNest is an AI-assisted therapy product for children with autism / ADHD (and
similar profiles). Parents/guardians manage a child's care; clinicians are brought
in later under a subscription model; admins oversee everything.

This repository is the **backend API**. Phase 1 ships the account + onboarding
foundation only — parent signup/login, email verification, password reset, account
deactivation, a public clinician-application form, and an admin bootstrap seed.
Video upload, the AI engine, the doctor app, the admin panel, billing, and RAG/chat
are explicitly **out of scope** for this phase.

## Stack

| Concern        | Choice |
|----------------|--------|
| Runtime        | Node 22, TypeScript 5.7 |
| Framework      | NestJS 11 (modular monolith, one module per domain, one folder per use-case) |
| Database       | PostgreSQL 16 via Prisma 6 |
| Auth           | In-house JWT access tokens + opaque, rotating refresh tokens |
| Validation     | class-validator / class-transformer, global `ValidationPipe` |
| Config         | `@nestjs/config` + Joi schema (fails fast at boot) |
| Logging        | `nestjs-pino` (structured, per-request id, secrets redacted) |
| Errors         | Global exception filter, one JSON error shape |
| Rate limiting  | `@nestjs/throttler` (generous global default; `/v1/auth/*` fixed at 5 req/60 s) |
| API docs       | `@nestjs/swagger` built from live code → Scalar at `/docs`, raw at `/openapi.json` |
| Observability  | Sentry (`@sentry/nestjs`), no-op when `SENTRY_DSN` unset |
| Email          | Abstract `EmailService`; `ResendEmailService` implementation; logs instead of sends when `RESEND_API_KEY` unset |

## Prerequisites

- Node 22+
- npm
- A PostgreSQL 16/18 database for development. Either a cloud instance (this repo's
  `.env` uses [Neon](https://neon.tech)) or local Postgres via Docker — see
  [Databases](#databases).
- Docker Desktop — **only** needed to run the e2e suite (`npm run test:e2e`), which
  spins up a throwaway local Postgres. Not needed just to run the app.

## Databases

Two independent databases are in play:

| | Used by | Configured by | How it's provisioned |
|---|---|---|---|
| **Dev database** | `npm run start:dev`, `npm run prisma:*`, `npm run db:seed` | `DATABASE_URL` | Cloud (Neon) or local Docker Postgres |
| **Test database** | `npm run test:e2e` only (truncated between specs) | `TEST_DATABASE_URL` | Local Docker Postgres (`docker compose up -d`) |

`docker-compose.yml` defines a single `postgres:16-alpine` container (user / password
/ db all `neuronest`, port `5432`, data in a named volume `neuronest-pgdata`). It is
the test database. If you'd rather not use a cloud dev database, point `DATABASE_URL`
at that same container too — see `.env.example`.

## Quickstart

```bash
npm install
cp .env.example .env                  # then edit values — see below

# --- dev database ---
# Option A (this repo's default): set DATABASE_URL to your Neon dev-branch
#   connection string (Neon dashboard -> your branch -> Connect -> copy).
# Option B: use local Docker Postgres instead:
#   docker compose up -d
#   DATABASE_URL=postgresql://neuronest:neuronest@localhost:5432/neuronest?schema=public

npm run prisma:deploy                # apply existing migrations to DATABASE_URL
npm run prisma:generate             # regenerate the Prisma client (usually automatic)
npm run db:seed                     # optional: first ADMIN from ADMIN_EMAIL / ADMIN_PASSWORD
npm run start:dev                   # http://localhost:3000
```

Minimum `.env` values to change: `DATABASE_URL` (your dev DB) and `JWT_ACCESS_SECRET`
(any string ≥ 16 chars). `RESEND_API_KEY` and `SENTRY_DSN` can stay empty — email is
logged to the console and Sentry is a no-op without them.

Verify: `GET http://localhost:3000/health` → `{ "status": "ok", "db": "up" }`.
API reference: `http://localhost:3000/docs`.

### Migrations: `prisma:deploy` vs `prisma:migrate`

- `npm run prisma:deploy` (`prisma migrate deploy`) — applies the migration files that
  already exist in `prisma/migrations/`. Use this for first-time setup and in CI/prod.
  Works over a pooled connection (e.g. Neon's `-pooler` host).
- `npm run prisma:migrate` (`prisma migrate dev`) — use only when you **change**
  `schema.prisma` and need to author a new migration. It needs a *direct*
  (non-pooled) connection and a shadow database; against Neon, set a `directUrl` in
  `schema.prisma` backed by the non-pooled connection string.

## Running the e2e suite

```bash
docker compose up -d                 # start the local test Postgres
npm run test:e2e                     # global-setup applies migrations to TEST_DATABASE_URL
docker compose down                  # stop it (add -v to also wipe the data volume)
```

## Where the docs live

Start here (this file) for setup and scripts. Everything else:

- **API reference** — `http://localhost:3000/docs` (Scalar), raw spec at `/openapi.json`.
- **Design docs** — [`docs/`](docs/README.md): the *why* behind the code — architecture,
  schema decisions, auth flows, RBAC, API conventions. [`docs/README.md`](docs/README.md)
  indexes them.
- **Delivery plans** — [`docs/plans/`](docs/plans/README.md): one file per phase, with a
  status table. The newest **Active** row is the current plan.
- **Agent / contributor instructions** — [`AGENTS.md`](AGENTS.md) (`CLAUDE.md` points at
  it).
- **Agent Skills** — [`.claude/skills/`](.claude/skills/): repo-local skills that codify
  the conventions in `AGENTS.md`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch-mode dev server |
| `npm run start` | One-shot dev server |
| `npm run build` | `nest build` → `dist/` |
| `npm test` | Unit tests (Jest, Prisma + Email mocked, no DB) |
| `npm run test:e2e` | End-to-end tests (real app, `FakeEmailService`, throwaway Postgres) |
| `npm run test:cov` | Unit tests with coverage |
| `npm run lint` | ESLint (flat config v9) with `--fix` |
| `npm run format` | Prettier over `src/` and `test/` |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:deploy` | `prisma migrate deploy` (CI / prod) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Prisma Studio |
| `npm run db:seed` | Idempotent first-ADMIN seed |
| `npm run docker:up` / `docker:down` | Local Postgres lifecycle |

## Testing

- **Unit** — one `*.spec.ts` next to each service; `PrismaService` and `EmailService`
  are mocked, no database is touched.
- **E2E** — `test/*.e2e-spec.ts` boot the real Nest app with `EmailService` replaced by
  `FakeEmailService` and a throwaway Postgres database (`TEST_DATABASE_URL`), migrated
  by `test/helpers/global-setup.ts` and truncated between specs. Covers
  signup→verify→login→refresh→logout, deactivate, clinician submit-application, and a
  doc-drift guard (`docs.e2e-spec.ts`).

## License

UNLICENSED — proprietary. License terms TBD.

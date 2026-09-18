# NeuroNest — Backend API

NeuroNest is an AI-assisted therapy platform designed for children with autism and ADHD. Parents and guardians manage a child's care plans and developmental progress, clinicians collaborate via structured caseload workflows, and system administrators oversee platform governance.

This repository hosts the **NeuroNest Backend API**, built as a modular monolith in NestJS and PostgreSQL.

---

## 1. System Overview & Core Capabilities

The backend currently delivers the following production-grade capabilities:
- **Authentication & Account Security**: Email/password signup with argon2id, email verification, login with opaque rotating refresh tokens and automatic family reuse revocation, and password reset.
- **User Profile Management**: Authenticated user profiles (`GET /v1/users/me`) and self-deactivation with immediate session invalidation.
- **Clinician Onboarding & Review**: Public clinician application intake and an administrative review workflow (listing, inspecting, approving, and rejecting applicants).
- **Authorization Engine**: Static Role-Based Access Control (RBAC) with compile-time type safety and automated route security guardrails.

> [!TIP]
> For delivery plans, active milestones, and future phase roadmaps, see [`docs/plans/README.md`](docs/plans/README.md).

---

## 2. Tech Stack

| Layer / Concern | Technology | Technical Rationale |
|---|---|---|
| **Runtime** | Node 22 (LTS), TypeScript 5.7 | Modern ECMAScript features, native performance, strict type checking |
| **Framework** | NestJS 11 | Modular monolith architecture, dependency injection, declarative validation |
| **Database & ORM** | PostgreSQL 16 via Prisma 6 | Relational consistency (3NF), UUIDv4 keys, JSONB flexibility, type-safe queries |
| **Authentication** | In-house JWT + Opaque Refresh Tokens | Argon2id password hashing, SHA-256 token hashing at rest, automatic token family revocation |
| **Validation** | `class-validator` & `class-transformer` | Global `ValidationPipe` with payload whitelisting and type coercion |
| **Error Handling** | RFC 9457 Problem Details | Standardized `application/problem+json` error envelopes with stable error codes |
| **Observability** | `nestjs-pino` & `@sentry/nestjs` | High-performance structured logging, request ID correlation, automated 5xx alerting |
| **Rate Limiting** | `@nestjs/throttler` | Per-route throttling; sensitive auth routes constrained to 5 req/60s |
| **API Documentation** | Scalar Reference (`@scalar/nestjs-api-reference`) | Interactive OpenAPI 3.0 docs rendered live at `/docs`, raw spec at `/openapi.json` |

---

## 3. Prerequisites

- **Node.js**: v22.x or higher
- **npm**: v10.x or higher
- **PostgreSQL 16**: Cloud instance (e.g. [Neon](https://neon.tech)) or local PostgreSQL via Docker
- **Docker Desktop**: Required to run the local containerized PostgreSQL instance for E2E tests

---

## 4. Quickstart

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
Edit `.env` with your settings:
- `DATABASE_URL`: Connection string for your development PostgreSQL database (Neon branch or local Docker).
- `JWT_ACCESS_SECRET`: Any secure random secret (&ge; 16 characters).
- *(Optional)*: `RESEND_API_KEY` (if unset, outgoing emails are logged to stdout).
- *(Optional)*: `SENTRY_DSN` (if unset, error tracking is a no-op).

### Step 3: Start Local Database (if using Docker)
```bash
npm run docker:up
```

### Step 4: Run Migrations & Seed
```bash
npm run prisma:deploy               # Apply existing database migrations
npm run prisma:generate             # Generate typed Prisma client
npm run db:seed                     # Seed initial ADMIN account (from ADMIN_EMAIL/ADMIN_PASSWORD)
```

### Step 5: Start Development Server
```bash
npm run start:dev
```
- API server runs at: `http://localhost:3000`
- Interactive API Documentation (Scalar): `http://localhost:3000/docs`
- Health check: `http://localhost:3000/health` &rarr; `{"status":"ok","db":"up"}`

---

## 5. Database Architecture & Workflows

NeuroNest operates a dual-database model ensuring development and automated testing never interfere:

- **Development Database (`DATABASE_URL`)**: Persistent database for local development, migrations, and manual testing.
- **Test Database (`TEST_DATABASE_URL`)**: Isolated local Docker Postgres database truncated between automated E2E suites.

```bash
# Database Management Scripts
npm run prisma:migrate              # Author a new migration (prisma migrate dev)
npm run prisma:deploy               # Apply migrations in CI/production (prisma migrate deploy)
npm run prisma:generate             # Regenerate TypeScript Prisma Client
npm run prisma:studio               # Launch Prisma Studio web GUI
npm run db:seed                     # Run idempotent database seed
```

> For comprehensive schema conventions, 3NF normalization, JSONB usage, and Docker Compose details, see [`docs/database-and-docker.md`](docs/database-and-docker.md).

---

## 6. Testing Strategy

We follow a two-tier testing methodology:
- **Unit Tests (`npm test`)**: Co-located with each service (`*.service.spec.ts`). Mock `PrismaService` and `EmailService`. Run entirely in memory with zero database or network overhead.
- **End-to-End Tests (`npm run test:e2e`)**: Spin up the real NestJS application against the local Docker PostgreSQL database (`TEST_DATABASE_URL`). Validate complete HTTP request/response lifecycles, authentication guards, transactions, and automated contract guardrails (`docs.e2e-spec.ts` and `rbac-route-coverage.e2e-spec.ts`).

```bash
npm test                            # Run all unit tests
npm run test:watch                  # Run unit tests in watch mode
npm run test:cov                    # Run unit tests with coverage report
npm run docker:up && npm run test:e2e # Run end-to-end tests
```

> For testing philosophy, mock examples, and troubleshooting, see [`docs/testing.md`](docs/testing.md).

---

## 7. Available Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Launch development server with file watch and auto-reload |
| `npm run build` | Compile production TypeScript build into `dist/` |
| `npm run start:prod` | Execute production build (`node dist/main.js`) |
| `npm test` | Run Jest unit tests (isolated, no DB) |
| `npm run test:e2e` | Run Jest E2E tests (real Nest app, local Docker DB) |
| `npm run lint` | Analyze and autofix TypeScript formatting & lint rules (ESLint v9) |
| `npm run format` | Format files with Prettier |
| `npm run docker:up` / `docker:down` | Manage local Docker Postgres container lifecycle |
| `npm run prisma:migrate` | Author and apply new migrations during local development |
| `npm run prisma:deploy` | Apply committed migrations (for CI, staging, and production) |
| `npm run prisma:generate` | Update Prisma Client types from `schema.prisma` |
| `npm run db:seed` | Run idempotent administrator bootstrapping seed |

---

## 8. Documentation Index

Detailed architectural documentation is organized in [`docs/`](docs/README.md):

- [Architecture & Scalability](docs/architecture.md) — Modular monolith topology, request pipeline, and 2–3 year growth seams.
- [API Conventions & Errors](docs/api-conventions.md) — HTTP standards, cursor pagination, and RFC 9457 Problem Details.
- [Database & Docker](docs/database-and-docker.md) — Schema normalization, JSONB, Docker Compose, and migration workflows.
- [Testing Guide](docs/testing.md) — Unit and E2E testing architecture, mock patterns, and contract drift guards.
- [Authentication Flows](docs/auth-flows.md) — Complete token rotation, argon2id hashing, and session revocation sequences.
- [RBAC & Permissions](docs/rbac.md) — Static role-to-permission mapping and route authorization.
- [Agent Guidelines](AGENTS.md) — Rules of engagement, coding standards, and AI agent context-loading matrix.
- [Agent Skills](.claude/skills/) — Actionable workflows for adding feature slices, permissions, and database migrations.

---

## 9. License

Proprietary — All rights reserved.

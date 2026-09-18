# Agent Guidelines & Contributor Rules

Instructions for AI agents and human contributors working in the NeuroNest backend repository (`CLAUDE.md` points here).

---

## 1. Overview & Project Roadmap

NeuroNest is an AI-assisted therapy backend for children with autism and ADHD.

> [!TIP]
> **Active Milestone & Phase Roadmap**:
> Implementation roadmap, phase scopes, and active task status are tracked exclusively in [`docs/plans/README.md`](docs/plans/README.md). Always consult the newest **Active** plan in `docs/plans/` before designing or scaffolding new features to align with the current project milestone.

---

## 2. Cardinal Rules (Non-Negotiable)

1. **Path Aliases Only — No `../` in Imports**:
   - `@app/*` &rarr; `src/*`
   - `@common/*` &rarr; `src/common/*`
   - `@modules/*` &rarr; `src/modules/*`
   - `@test/*` &rarr; `test/*`
   - Same-directory or sub-directory imports remain `./relative`. Relative parent traversing (`../`) is strictly prohibited.
2. **Modular Monolith & Feature Folders**:
   - Modules live in `src/modules/<domain>/`. Shared cross-cutting infra lives in `src/common/<concern>/`.
   - Each use-case is self-contained in `src/modules/<domain>/features/<use-case>/` containing its controller, service, DTOs, and unit spec.
   - **No repository layer**: Prisma is the data access layer.
3. **Explicit Route Authorization**:
   - Every controller handler must be decorated with either `@Public()` or an explicit permission: `@Auth('<permission>')`.
   - Any unannotated handler causes the automated security guard (`test/rbac-route-coverage.e2e-spec.ts`) to fail.
4. **Strict DTO Validation**:
   - Every input field must have `class-validator` decorators.
   - Global `ValidationPipe` is set to `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true`. Undeclared fields yield a `400 VALIDATION_ERROR`.
5. **Uniform RFC 9457 Error Handling**:
   - Throw NestJS `HttpException` subclasses with an object body: `throw new ConflictException({ code: 'STABLE_CODE', message: '...' })`.
   - `AllExceptionsFilter` repackages all thrown exceptions into an RFC 9457 `application/problem+json` envelope. Do not format error responses manually.
6. **Zero Account Enumeration**:
   - Public auth endpoints must never leak account existence.
   - Signup with already-verified email &rarr; `409 Conflict`.
   - Resend verification & forgot-password &rarr; always `202 Accepted`.
   - Login credential failures &rarr; uniform `401 INVALID_CREDENTIALS`.
7. **Tokens Hashed at Rest**:
   - Refresh tokens and verification tokens must only be stored as SHA-256 hashes (`@common/crypto/token.util`). Never store or log raw secrets.
8. **OpenAPI Spec Synchronization**:
   - The OpenAPI specification is generated from live metadata.
   - When modifying or adding routes, keep `EXPECTED` in `test/docs.e2e-spec.ts` in sync (method, path, operationId).

---

## 3. Context-Loading Matrix (When to Read Which File)

To maintain a lean context window, **do not read the entire `docs/` directory**. Read only the specific skill or document needed for your current task:

| Developer / Agent Task | Skill to Invoke | Reference Document to Load | Scope & Guidance |
|---|---|---|---|
| **Add a new endpoint or use-case** | `.claude/skills/feature-slice/` | [`docs/api-conventions.md`](docs/api-conventions.md) | Feature-folder layout, DTO validation, `@ApiOperation`, HTTP status codes, OpenAPI drift guard. |
| **Add or gate RBAC permissions** | `.claude/skills/add-permission/` | [`docs/rbac.md`](docs/rbac.md) | Update `PERMISSIONS` tuple and `ROLE_PERMISSIONS`, apply `@Auth()`, service-level scoping. |
| **Modify schema, run migrations, Docker** | `.claude/skills/prisma-migration/` | [`docs/database-and-docker.md`](docs/database-and-docker.md)<br>[`docs/schema-decisions.md`](docs/schema-decisions.md) | Relational normalization, UUIDv4 keys, JSONB, `migrate dev` vs `deploy`, Docker Postgres lifecycle. |
| **Write or run unit / E2E tests** | — | [`docs/testing.md`](docs/testing.md) | Unit test mocking (`PrismaService`, `EmailService`), Docker throwaway Postgres, test data truncation, guardrails. |
| **Auth logic, tokens, password reset** | — | [`docs/auth-flows.md`](docs/auth-flows.md) | Argon2id hashing, rotating refresh tokens, family reuse revocation, email verification sequences. |
| **Understand architecture or scalability** | — | [`docs/architecture.md`](docs/architecture.md) | Modular monolith topology, request pipeline, observability (Pino, Sentry), 2–3 year growth seams. |
| **Check project status or delivery plans** | — | [`docs/plans/README.md`](docs/plans/README.md) | Delivery plans per phase; current active milestone. |

---

## 4. Essential Commands

| Command | Description |
|---|---|
| `npm run start:dev` | Launch watch-mode development server (`http://localhost:3000`, docs at `/docs`) |
| `npm run build` | Compile the NestJS application to `dist/` via `nest build` |
| `npm test` | Run all unit tests (in-memory, mocked Prisma/Email, fast) |
| `npm run test:e2e` | Run E2E test suite (requires Docker Postgres running) |
| `npm run lint` | Check and fix lint issues via ESLint (flat config v9) |
| `npm run format` | Format codebase via Prettier |
| `npm run docker:up` / `docker:down` | Start or stop local PostgreSQL Docker container |
| `npm run prisma:migrate` | Author a new migration via `prisma migrate dev` (dev DB only) |
| `npm run prisma:deploy` | Apply pending migrations via `prisma migrate deploy` (CI / prod) |
| `npm run prisma:generate` | Regenerate `@prisma/client` types |
| `npm run db:seed` | Run idempotent database seed script (`prisma/seed.ts`) |

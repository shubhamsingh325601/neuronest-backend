# Database and Docker Architecture

This document defines the database architecture, schema conventions, Docker containerization, and Prisma migration workflows for the NeuroNest backend.

---

## 1. Architectural Principles

NeuroNest uses **PostgreSQL 16** managed through **Prisma 6** as an Object-Relational Mapping (ORM) and schema migration engine.

- **Prisma is the Data Layer**: There is no hand-written repository layer. Services inject `PrismaService` directly and interact with strongly typed models.
- **Relational Normalization (3NF)**: Core domain models are structured in third normal form (3NF). Data consistency, referential integrity, and domain invariants are enforced at the database level using foreign keys, unique constraints, and enums.
- **Selective JSONB for Unstructured Data**: Where domain requirements call for dynamic schemas, audit metadata, or flexible attribute bags, PostgreSQL native `jsonb` columns are used instead of premature entity explosion.
- **Strict Environment Isolation**: Development and End-to-End (E2E) testing use completely isolated databases. The test database is ephemeral and wiped between test runs, while the development database persists state.

> [!TIP]
> **Entity-by-Entity Schema Rationale (ADR)**:
> For detailed architectural rationale behind individual tables and fields (e.g. why `passwordHash` is nullable, why `VerificationToken` is a single polymorphic table, and why refresh tokens are hashed with SHA-256 at rest), consult the Architecture Decision Record: [`schema-decisions.md`](schema-decisions.md).

---

## 2. Schema Conventions & Design Standards

All schema definitions live in `prisma/schema.prisma`. Adhere to the following conventions when authoring or reviewing models:

### Naming Conventions
- **Database Tables**: Plural `snake_case` mapped via `@@map("table_name")` (e.g. `@@map("users")`, `@@map("refresh_tokens")`).
- **Database Columns**: `snake_case` mapped via `@map("column_name")` where column names diverge from TypeScript defaults (e.g. `passwordHash String? @map("password_hash")`).
- **Prisma Models**: Singular `PascalCase` (e.g. `User`, `RefreshToken`, `ClinicianApplication`).
- **Prisma Fields**: `camelCase` (e.g. `emailVerifiedAt`, `passwordHash`).
- **Enums**: `PascalCase` names with `UPPER_SNAKE_CASE` values (e.g. `enum UserStatus { ACTIVE, SUSPENDED, DEACTIVATED, INVITED }`).

### Identifiers & Keys
- **Primary Keys**: Always use UUIDv4 strings:
  ```prisma
  id String @id @default(uuid()) @db.Uuid
  ```
  UUIDv4 avoids sequential ID enumeration attacks, allows client/service-side ID generation where beneficial, and simplifies distributed data operations.
- **Foreign Keys**: Explicit relation fields paired with an underlying UUID column:
  ```prisma
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  ```

### Timestamps & Auditability
Every core table must track lifecycle timestamps:
```prisma
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
```

### Indexing Strategy
- **Lookup Fields**: Every field used in equality lookups (`email`, `tokenHash`) must be backed by a `@unique` constraint or `@@index`.
- **Foreign Key Columns**: Always index foreign key columns used in filtering or joins.
- **Compound Indexes**: When queries filter across multiple columns (e.g. `[userId, type]` or `[status, createdAt]`), define a composite index:
  ```prisma
  @@index([userId, type])
  ```

### Soft Deletion & Account Deactivation
Do not use generic soft-delete flags (`isDeleted`) that complicate unique constraints and queries. Instead, model account lifecycle explicitly:
- `UserStatus` enum: `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `INVITED`.
- Explicit timestamps for tracking lifecycle events: `selfExcludedAt`, `emailVerifiedAt`, `lastLoginAt`.

---

## 3. Dual Database Architecture

Two independent databases operate across local and CI environments:

| Database | Used By | Connection Variable | Target Engine | Persistence |
|---|---|---|---|---|
| **Development Database** | `npm run start:dev`, `npm run prisma:*`, `npm run db:seed` | `DATABASE_URL` | Cloud (Neon branch) or Local Docker Postgres | Persistent |
| **Test Database** | `npm run test:e2e` only | `TEST_DATABASE_URL` | Local Docker Postgres container (`neuronest-postgres`) | Ephemeral (truncated between suites) |

### Why This Separation Matters
1. **Zero Contamination**: Running e2e tests will **never** truncate, overwrite, or corrupt your local development or seed data.
2. **Speed**: E2E tests run on local Postgres without network latency from cloud providers.
3. **Reproducibility**: E2E tests run migrations from scratch on a clean database before running the suite (`test/helpers/global-setup.ts`).

---

## 4. Docker Compose Setup

Local database infrastructure is defined in `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: neuronest-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: neuronest
      POSTGRES_PASSWORD: neuronest
      POSTGRES_DB: neuronest
    ports:
      - '5432:5432'
    volumes:
      - neuronest-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U neuronest -d neuronest']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  neuronest-pgdata:
```

### Container Lifecycle Commands

| Command | Action |
|---|---|
| `npm run docker:up` | Starts the Postgres container in the background (`docker compose up -d`) |
| `npm run docker:down` | Stops the container (`docker compose down`) |
| `docker compose down -v` | Stops the container and **purges** the `neuronest-pgdata` volume (wipes all local data) |
| `docker compose ps` | Checks container status and healthcheck |

---

## 5. Prisma Migrations & Workflows

### Command Overview

| Command | Under the Hood | Purpose | Connection Requirement |
|---|---|---|---|
| `npm run prisma:migrate` | `prisma migrate dev` | Authors a new migration from changes in `schema.prisma` | Direct, non-pooled connection + Shadow DB |
| `npm run prisma:deploy` | `prisma migrate deploy` | Applies existing committed migrations | Works on pooled connections (Neon `-pooler`, CI/prod) |
| `npm run prisma:generate` | `prisma generate` | Regenerates `@prisma/client` TypeScript types | None (local code generation) |
| `npm run prisma:studio` | `prisma studio` | Launches web UI to view and edit database rows | `DATABASE_URL` |
| `npm run db:seed` | `ts-node prisma/seed.ts` | Runs the idempotent seed script | `DATABASE_URL` |

### Step-by-Step: Authoring a Migration

When altering models or adding new entities:

1. **Update `prisma/schema.prisma`**:
   Add or modify fields, models, enums, or indexes following the conventions in Section 2.
2. **Ensure Docker Postgres is running**:
   ```bash
   npm run docker:up
   ```
3. **Generate and apply the migration**:
   ```bash
   npm run prisma:migrate -- --name <descriptive_migration_name>
   ```
   *Example*: `npm run prisma:migrate -- --name add_clinician_notes`
4. **Verify generated client**:
   Prisma automatically triggers `prisma generate` after migration dev, updating TypeScript definitions in `node_modules/@prisma/client`.
5. **Run tests**:
   ```bash
   npm test
   npm run test:e2e
   ```

### Deploying Migrations in CI / Production (`prisma:deploy`)

- In production or CI pipelines, **never** run `prisma migrate dev`.
- Run `npm run prisma:deploy`. It reads the migration history from the `_prisma_migrations` table and applies unapplied migrations sequentially.
- Works safely over connection poolers (such as PgBouncer or Neon connection poolers).

---

## 6. Database Seeding & Admin Bootstrapping

The seed script (`prisma/seed.ts`) is designed to be **idempotent**: running it multiple times will never produce duplicate records or fail.

### How it Works:
- Reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment.
- Hashes the password using `argon2id` with the same production parameters defined in `CryptoModule`.
- Uses `prisma.user.upsert()`:
  - If the user exists: updates role to `ADMIN`, status to `ACTIVE`, and verified timestamp.
  - If the user does not exist: creates the user record with role `ADMIN`.

```bash
npm run db:seed
```

---

## 7. Operational Guardrails & Anti-Patterns

> [!CAUTION]
> **Never run `prisma migrate dev` against pooled connections**:
> Connection poolers (like Neon `-pooler` or PgBouncer in transaction pooling mode) do not support the session-level advisory locks and shadow databases required by `prisma migrate dev`. Always point to a direct connection or local Docker instance when authoring migrations. `prisma migrate deploy` doesn't create a shadow DB and has been observed working against Neon's pooled connection, but it's still undocumented/unsupported behavior on Neon's side — prefer the direct connection for it too now that `DATABASE_DIRECT_URL` is wired in (see below), rather than relying on it continuing to work.

### `DATABASE_DIRECT_URL` (Neon pooled/unpooled split)

`schema.prisma`'s `datasource` block declares both `url` (`DATABASE_URL`) and
`directUrl` (`DATABASE_DIRECT_URL`). The Prisma **Client** (used by the running app,
via `PrismaService`) only ever uses `url`. The Prisma **CLI**'s schema-changing
commands (`migrate dev`, `migrate deploy`, `db push`) use `directUrl` automatically
when it's present — no manual `DATABASE_URL` override needed anymore.

- **Local Docker Postgres**: no pooler in front of it, so `DATABASE_DIRECT_URL` is
  just the same value as `DATABASE_URL` (see `.env.example`).
- **Neon**: `DATABASE_URL` is the pooled connection string (hostname has `-pooler`);
  `DATABASE_DIRECT_URL` is the same database's unpooled connection string (same
  hostname, no `-pooler`) — copy it from the Neon console's connection details.

Once `directUrl` is declared in the schema, it must resolve to a real connection
string whenever a schema-changing command runs — an empty `DATABASE_DIRECT_URL` will
make `migrate`/`db push` fail, even if `DATABASE_URL` itself is fine. `.env.example`'s
default keeps both vars equal for local Docker for exactly this reason.

> [!WARNING]
> **Never modify migration files that have been merged**:
> Once a migration in `prisma/migrations/` has been merged or applied in staging/production, it is immutable. To make changes, alter `schema.prisma` and create a new migration.

> [!IMPORTANT]
> **Never hardcode credentials or connection strings**:
> All database connections must be driven through `.env` variables (`DATABASE_URL`, `TEST_DATABASE_URL`). Keep `.env` gitignored and `.env.example` committed with placeholder values.

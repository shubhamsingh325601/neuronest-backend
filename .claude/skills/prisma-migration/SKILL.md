---
name: prisma-migration
description: >-
  Modify the Prisma schema, author and apply PostgreSQL database migrations,
  regenerate the Prisma client, seed the database, or manage local Docker database
  containers. Covers schema conventions (UUIDv4, @@map snake_case, relations,
  indexes), migrate dev vs deploy, and idempotent seeding. Use when asked to "add a
  column", "create a table", "modify schema.prisma", "run a migration", "apply
  migrations", "prisma migrate", "seed the database", or "manage postgres docker".
---

# Prisma Database Workflow & Migrations

This skill guides you through schema modeling, creating migrations, regenerating the client, and seeding in the NeuroNest backend. Detailed architecture rationale is in `docs/database-and-docker.md` and `docs/schema-decisions.md`.

## Schema Conventions Checklist

Before creating a migration, ensure changes in `prisma/schema.prisma` follow these standards:
- **Primary Keys**: Always `id String @id @default(uuid()) @db.Uuid`.
- **Table Naming**: Plural `snake_case` using `@@map("table_names")`.
- **Column Naming**: Multi-word fields mapped to `snake_case` using `@map("column_name")`.
- **Foreign Keys**: Explicit relation fields paired with UUID scalar:
  ```prisma
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  ```
- **Indexes**: Add explicit `@unique` or `@@index` on columns used in queries or joins.
- **Timestamps**: Always include `createdAt DateTime @default(now()) @map("created_at")` and `updatedAt DateTime @updatedAt @map("updated_at")`.

## Procedure

### 1. Update `prisma/schema.prisma`
Apply your model, enum, or field changes following the conventions above.

### 2. Ensure Local PostgreSQL Container is Running
`prisma migrate dev` needs a direct connection and a shadow database:
```bash
npm run docker:up
```

### 3. Create and Apply the Migration
Run the dev migration command with a concise, descriptive name:
```bash
npm run prisma:migrate -- --name <descriptive_name>
```
*Example*: `npm run prisma:migrate -- --name add_parent_profile_fields`

This automatically:
- Creates a new SQL migration file under `prisma/migrations/<timestamp>_<name>/migration.sql`.
- Applies it to your development database.
- Triggers `prisma generate` to update `@prisma/client` TypeScript types.

### 4. Regenerate Types (if needed independently)
If you only pulled existing migrations or changed schema client options:
```bash
npm run prisma:generate
```

### 5. Seed the Database (Optional)
If your change introduces required reference data or you are setting up a clean database:
```bash
npm run db:seed
```

### 6. Verify
Run both the unit test suite and the E2E suite (which tests real PostgreSQL schema & migrations):
```bash
npm test
npm run test:e2e
```

## Critical Rules & Pitfalls

- **Never edit a committed migration file**: Once a migration has been applied or pushed, create a new migration instead of editing the old `.sql` file.
- **`prisma:migrate` vs `prisma:deploy`**:
  - `npm run prisma:migrate` (`prisma migrate dev`): ONLY for development. Requires direct non-pooled database connection and shadow database.
  - `npm run prisma:deploy` (`prisma migrate deploy`): For CI, staging, production, and connection poolers (e.g. Neon `-pooler`).
- **Never point dev server to `TEST_DATABASE_URL`**: E2E tests truncate all tables in `TEST_DATABASE_URL` between suites.

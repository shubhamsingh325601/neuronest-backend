import { execSync } from 'node:child_process';
import * as dotenv from 'dotenv';

/**
 * Runs once before the e2e suite: applies migrations to the test database.
 *
 * Point `TEST_DATABASE_URL` at a throwaway database (local Docker Postgres, not
 * Neon) — the suite truncates every table between specs.
 *
 * Both `DATABASE_URL` and `DATABASE_DIRECT_URL` must be overridden here, not just
 * `DATABASE_URL`: per docs/database-and-docker.md §7, the Prisma CLI's
 * schema-changing commands (`migrate deploy` included) use `directUrl` automatically
 * whenever it's set in `schema.prisma`, ignoring `url` entirely. Overriding only
 * `DATABASE_URL` silently ran migrations against whatever `DATABASE_DIRECT_URL`
 * pointed at in `.env` — a real Neon database in local dev — while every other part
 * of the app (the Prisma Client, via `PrismaService`) correctly used the overridden
 * `DATABASE_URL`. Harmless as long as no migration was actually pending, but the
 * class of bug is real: the next new migration would have deployed there for real.
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set for e2e tests.');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DATABASE_DIRECT_URL: url },
  });
}

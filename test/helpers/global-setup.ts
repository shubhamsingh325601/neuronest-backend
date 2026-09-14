import { execSync } from 'node:child_process';
import * as dotenv from 'dotenv';

/**
 * Runs once before the e2e suite: applies migrations to the test database.
 *
 * Point `TEST_DATABASE_URL` at a throwaway database — the suite truncates every
 * table between specs. If it is unset, `DATABASE_URL` is used (fine for CI-style
 * ephemeral databases, destructive against a real dev database).
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config();
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set for e2e tests.');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

import * as dotenv from 'dotenv';

dotenv.config();

process.env.NODE_ENV = 'test';
process.env.SENTRY_DSN = '';
// Route the app at the throwaway test database when one is configured.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
// Keep argon2 cheap in tests.
process.env.ARGON2_MEMORY_KIB = '8192';
process.env.ARGON2_TIME_COST = '1';

jest.setTimeout(30000);

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

// Background jobs: no cron/boot sweep in tests; the post-commit kick runs inside the request
// so specs that read `ctx.mail` right after an HTTP call keep working (plan 0011 §3 row 17).
process.env.JOBS_ENABLED = 'false';
process.env.JOBS_KICK_MODE = 'inline';

// AI (plan 0018): off by default, never any provider key, and no request may leave the machine.
// Tests that exercise AI use FakeAiService (or a mock model); a live call from CI is a bug.
process.env.AI_ENABLED = 'false';
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(raw, 'http://localhost').hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`e2e tests must not make outbound requests (blocked fetch to ${host})`);
  }
  return realFetch(input, init);
}) as typeof fetch;

jest.setTimeout(30000);

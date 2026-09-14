/**
 * E2E stub for `@scalar/nestjs-api-reference`.
 *
 * The real package pulls in `@scalar/client-side-rendering`, which ships as ESM and
 * trips Jest's CommonJS loader (node_modules is not transformed). Nothing in the e2e
 * suite exercises the Scalar UI at `/docs` — the doc-drift test reads `/openapi.json`,
 * which `setupOpenApi` serves directly from the in-memory document. So we swap
 * `apiReference` for a pass-through middleware. The real UI is smoke-tested against the
 * running server in the Phase 1 runtime checklist (§7 Step E).
 */
export const apiReference =
  () =>
  (_req: unknown, _res: unknown, next: () => void): void =>
    next();

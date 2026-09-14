---
name: add-permission
description: >-
  Introduce a new permission into the NeuroNest static RBAC map, or gate a route
  with one. Covers the resource:action[:scope] naming, declaring it in the
  PERMISSIONS tuple, granting it in ROLE_PERMISSIONS, applying @Auth(), where
  scope/ownership is actually enforced, and when a change needs a decision note in
  docs/rbac.md. Use when asked to "add a permission", "gate a route", "require a
  permission", or to add a new "resource:action" string.
---

# Adding a permission

Phase 2 authorization is a **static role → permission map in code**
(`src/common/authz/permissions.ts`). No CASL, no RBAC tables, no `AbilityFactory` —
those are deliberate non-goals until a rule needs a *condition*. Full model in
`docs/rbac.md`; this is the procedure. The canonical checklist is
`docs/adding-a-permission.md` — keep the two in sync if you change one.

## Naming

`resource:action[:scope]`, lower-case, colon-separated, `kebab-case` for multi-word
resources. Existing catalogue: `user:read:self`, `user:deactivate:self`,
`clinician-application:list`, `clinician-application:review`. Add `:self` (or a future
scope) only when the same action also exists at a broader scope and they must be
distinguished.

## Steps

1. **Declare** — add the string to the `PERMISSIONS` tuple in
   `src/common/authz/permissions.ts`. It is `as const`, so the `Permission` union
   updates automatically and every `@Auth('…')` call site is type-checked.
2. **Grant** — add it to each role that should hold it in `ROLE_PERMISSIONS` (same
   file). `SELF_PERMISSIONS` is the helper for `*:self` perms every self-service role
   gets. `ADMIN` spreads `...PERMISSIONS`, so an admin-only permission needs no `ADMIN`
   edit — but a permission `ADMIN` should *not* have does.
3. **Gate the route** — `@Auth('resource:action')` on the handler (adds the bearer +
   401 OpenAPI docs), or `@RequirePermissions('resource:action')` for the metadata
   alone. A handler with neither `@Public()` nor a permission fails
   `test/rbac-route-coverage.e2e-spec.ts`.
4. **Enforce scope in the service, not the guard** — the guard only checks
   *role holds permission*. "Only your own record", "only rows in your caseload", any
   conditional rule: load the object in the service, compare ids, and
   `throw new ForbiddenException({ code: 'FORBIDDEN', message: '...' })`.

## Write a decision note in docs/rbac.md (not just a code line) when

- the grant crosses a role boundary that isn't self-evident (a `CLINICIAN` permission
  beyond the self-service set; something withheld from `ADMIN`);
- the permission implies data scoping the guard can't see — record where/how the service
  enforces it;
- **you reach for a *condition*** ("… only if assigned to …"). Stop. That is the
  documented trigger to move to `@casl/ability` (migration path in `docs/rbac.md`), not
  something to bolt onto the static map. Flag it rather than working around it.

## Verify

```bash
npm run lint
npm test
docker compose up -d && npm run test:e2e   # rbac-route-coverage + any gated-route e2e
```

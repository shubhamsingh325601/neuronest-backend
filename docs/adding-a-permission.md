# Adding a permission

A checklist for introducing a new permission into the static RBAC map. For the model
behind it — guard order, the `@casl/ability` migration path, why ownership is not a
permission — see [rbac.md](rbac.md).

## Naming

`resource:action[:scope]`, lower-case, colon-separated. Match the existing catalogue:

| Example | Shape |
|---------|-------|
| `user:read:self` | `resource:action:scope` — acts only on the caller's own record |
| `user:deactivate:self` | ″ |
| `clinician-application:list` | `resource:action` — no scope qualifier |
| `clinician-application:review` | ″ |

`resource` is the domain noun (singular, kebab-case for multi-word — `clinician-application`).
`action` is the verb. Add `:self` (or a future scope) only when the same action exists
at a broader scope and the two must be told apart.

## Steps

1. **Declare it.** Add the string to the `PERMISSIONS` tuple in
   `src/common/authz/permissions.ts`. It is `as const`, so the `Permission` union
   updates automatically and every `@Auth('…')` / `@RequirePermissions('…')` call site
   is type-checked against the new catalogue.

2. **Grant it.** Add the permission to each role that should hold it in
   `ROLE_PERMISSIONS` in the same file. Use the `SELF_PERMISSIONS` helper for `*:self`
   permissions that every self-service role gets (`PARENT`, `CLINICIAN`, `ADMIN`).
   `ADMIN` spreads `...PERMISSIONS`, so an admin-only permission needs no change there —
   but a permission that admins should *not* have does.

3. **Gate the route.** Put `@Auth('resource:action')` on the handler (or
   `@RequirePermissions('resource:action')` if the bearer/401 OpenAPI docs from `@Auth`
   are not wanted). The `rbac-route-coverage.e2e-spec.ts` test fails if a route has
   neither `@Public()` nor a permission requirement.

4. **Enforce scope in the service, not the guard.** The guard only checks
   role-holds-permission. "Only your own record", "only rows in your caseload", and
   every other *conditional* rule is checked inline in the service against the loaded
   object (compare ids, throw `FORBIDDEN`). See the ownership section in
   [rbac.md](rbac.md).

## When to write a decision note in rbac.md instead of just adding a line

Adding a line to `permissions.ts` is enough for a routine permission. Open
[rbac.md](rbac.md) and write down the reasoning when any of these are true:

- **The grant crosses a role boundary that isn't self-evident** — e.g. giving
  `CLINICIAN` something beyond the self-service set, or withholding something from
  `ADMIN`.
- **The permission implies data scoping the guard cannot see** — note where and how the
  service enforces the scope, so the next person doesn't assume the guard covers it.
- **You reach for a *condition*** ("… only if assigned to …", "… only during …"). Stop.
  That is the documented trigger to graduate to `@casl/ability` (see the migration path
  in [rbac.md](rbac.md)); it is not something to bolt onto the static map. Flag it
  rather than working around it.

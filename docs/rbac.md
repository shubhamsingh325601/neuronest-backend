# RBAC

Phase 1 authorization is a **static role → permission map in code**. No RBAC tables, no
per-row policy rows, no `@casl/ability` yet — those are deliberate non-goals until rules
become conditional.

## The map

`src/common/authz/permissions.ts`:

```ts
export const PERMISSIONS = [
  'user:read:self',
  'user:deactivate:self',
  'clinician-application:list',    // GET  /v1/clinician-applications(/:id)   — ADMIN only
  'clinician-application:review',  // POST /v1/clinician-applications/:id/(approve|reject)
] as const;

const SELF_PERMISSIONS = ['user:read:self', 'user:deactivate:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PARENT:    [...SELF_PERMISSIONS],
  CLINICIAN: [...SELF_PERMISSIONS],
  ADMIN:     [...PERMISSIONS],
};

roleHasPermission(role, permission): boolean
```

The `clinician-application:*` pair became live in Phase 3 (admin review of clinician
applications). Both are unconditional `ADMIN`-only grants — `roleHasPermission` in
`PermissionsGuard` fully enforces them, no service-side scope check is involved — so
no decision note was warranted (per [adding-a-permission.md](adding-a-permission.md)),
just the two lines already in `permissions.ts`.

Adding one? [adding-a-permission.md](adding-a-permission.md) is the step-by-step: the
naming convention, where to declare and grant it, and when a change warrants a decision
note in this file rather than just another line in `permissions.ts`.

## Decorators

| Decorator | Effect |
|-----------|--------|
| `@Public()` | Skip `JwtAuthGuard` **and** `PermissionsGuard`. |
| `@Auth(...perms)` | Mark authenticated + require `perms`; also adds `@ApiBearerAuth()` / 401 response docs. |
| `@RequirePermissions(...perms)` | Attach required permissions only (no OpenAPI side-effects). |
| `@CurrentUser()` | Param decorator → `request.user` (`AuthenticatedUser`: `id`, `email`, `role`, `status`). |

Routes with neither `@Public()` nor any permission requirement are authenticated but not
permission-gated (they pass `PermissionsGuard` on the "no `required` list" branch).

## Guard order

Registered as `APP_GUARD` in `app.module.ts`, executed in this order:

1. **`ThrottlerGuard`** — rate limiting. `/v1/auth/*` controllers add `@AuthThrottle()`
   (fixed 5 req / 60 s).
2. **`JwtAuthGuard`** — authentication. Verifies the bearer access-token signature and
   expiry, then re-reads the account from the database (indexed PK lookup) and rejects
   it if the row is gone (`INVALID_TOKEN`) or its current `status` is not `ACTIVE`
   (`ACCOUNT_NOT_ACTIVE`) — so deactivation / suspension bites on the next request, not
   at token expiry. Populates `request.user` from that fresh row. `@Public()`
   short-circuits to allow.
3. **`PermissionsGuard`** — authorization. Reads `@RequirePermissions` metadata and
   checks each against `roleHasPermission(user.role, perm)`. Missing ⇒ 403
   `INSUFFICIENT_PERMISSIONS`. `@Public()` or an empty requirement list ⇒ allow.

## Ownership

"Acting on your own account" is **not** a permission — it is checked inline in the
service. `GET /v1/users/me` and `POST /v1/users/me/deactivate` operate on
`@CurrentUser().id` directly, so there is no cross-user object to authorize. When a route
can address another user's resource, the service compares ids and throws `FORBIDDEN`
itself.

## Migration path to `@casl/ability`

The static map is a strict subset of what CASL expresses. When a rule first needs a
**condition** (e.g. "a CLINICIAN may read a child record *only if* assigned to that
child's caseload"):

1. Keep `PERMISSIONS` as the action vocabulary.
2. Replace `ROLE_PERMISSIONS` with an `AbilityFactory` that, given a user, calls
   `can(action, subject, conditions?)` — seeding the unconditional grants straight from
   the current map so nothing regresses.
3. Swap `PermissionsGuard`'s `roleHasPermission` call for `ability.can(...)`, resolving
   the subject from the route.
4. `@Auth('user:read:self')` style call sites stay; only the guard internals change.

**No database migration is required** to reach this point — the map is code, and CASL
conditions are evaluated against objects already loaded in the service. RBAC tables would
only be needed if permissions had to be editable at runtime by admins, which is not a
Phase 1 (or near-term) requirement.

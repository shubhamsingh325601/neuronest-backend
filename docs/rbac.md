# Role-Based Access Control (RBAC) & Permissions

This document defines the authorization model, decorator lifecycle, guard execution order, and the checklist for introducing new permissions in the NeuroNest backend.

---

## 1. Authorization Model: Static Code-Based Map

NeuroNest employs a **compile-time static role-to-permission mapping in code** (`src/common/authz/permissions.ts`). 

There are deliberately no dynamic RBAC database tables (`roles`, `permissions`, `role_permissions`) and no complex policy engines in this phase. The static map provides:
- **Zero Database Overhead**: Permission checks run synchronously in memory without database queries.
- **Compile-Time Type Safety**: Permissions are defined as a TypeScript `as const` tuple; invalid permission strings in `@Auth()` decorators fail type checking at compile time.
- **Auditable in Version Control**: All role permissions and capability grants are versioned in git history.

### The Canonical Mapping (`src/common/authz/permissions.ts`)

```typescript
export const PERMISSIONS = [
  'user:read:self',
  'user:deactivate:self',
  'clinician-application:list',    // GET  /v1/clinician-applications(/:id) — ADMIN only
  'clinician-application:review',  // POST /v1/clinician-applications/:id/(approve|reject)
  'child:create:self',             // POST /v1/children — PARENT only
  'child:read',                    // GET  /v1/children/:id — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'clinician-child:manage',        // POST /v1/children/:id/clinicians — ADMIN only
  'media:create:self',             // POST /v1/children/:id/media/upload-tickets, /v1/media/:id/confirm — PARENT only
  'media:read',                    // GET  /v1/children/:id/media — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'plan-template:manage',          // POST /v1/plan-templates(/:id/publish) — ADMIN only
  'plan-template:read',            // GET  /v1/plan-templates(/:id) — CLINICIAN(published-only)/ADMIN(any)
  'plan:manage',                   // POST /v1/children/:id/plans, /v1/plans/:id/(complete|archive) — CLINICIAN(assigned)/ADMIN
  'plan:read',                     // GET  /v1/children/:id/plans/today — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'plan-note:create',              // POST /v1/plans/:id/notes — CLINICIAN(assigned)/ADMIN
  'plan-note:read',                // GET  /v1/plans/:id/notes — CLINICIAN(assigned)/ADMIN — not PARENT
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_PERMISSIONS: Permission[] = ['user:read:self', 'user:deactivate:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PARENT:    [...SELF_PERMISSIONS, 'child:create:self', 'child:read', 'media:create:self', 'media:read', 'plan:read'],
  CLINICIAN: [...SELF_PERMISSIONS, 'child:read', 'media:read', 'plan-template:read', 'plan:manage', 'plan:read', 'plan-note:create', 'plan-note:read'],
  ADMIN:     [...PERMISSIONS],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

---

## 2. Decorators Reference

| Decorator | Target | Effect |
|---|---|---|
| `@Public()` | Handler / Class | Skips `JwtAuthGuard` **and** `PermissionsGuard`. Route is publicly accessible. |
| `@Auth(...perms)` | Handler | Marks route authenticated + requires specified permissions. Automatically configures OpenAPI Bearer security and 401 response documentation. |
| `@RequirePermissions(...perms)` | Handler | Attaches permission metadata without OpenAPI swagger side-effects. |
| `@CurrentUser()` | Parameter | Extracts the authenticated user object (`id`, `email`, `role`, `status`) attached by `JwtAuthGuard`. |

> [!NOTE]
> Every route handler must have an explicit security annotation (`@Public()` or `@Auth(...)`). Handlers missing both fail the automated security guard (`test/rbac-route-coverage.e2e-spec.ts`).

---

## 3. Guard Execution Order

Guards are registered as `APP_GUARD` providers in `app.module.ts` and execute in strict sequential order:

```
Incoming Request
  │
  ├─ 1. ThrottlerGuard (Rate Limiting)
  │     Evaluates request count against IP limits.
  │
  ├─ 2. JwtAuthGuard (Authentication)
  │     1. Skips if handler has @Public().
  │     2. Verifies Bearer JWT signature and TTL.
  │     3. Re-reads account status from PostgreSQL (indexed PK lookup).
  │     4. Rejects immediately if user row is deleted or status != ACTIVE.
  │     5. Attaches AuthenticatedUser to request.user.
  │
  └─ 3. PermissionsGuard (Authorization)
        1. Skips if handler has @Public() or requires no permissions.
        2. Checks each required permission against roleHasPermission(user.role, perm).
        3. Throws 403 INSUFFICIENT_PERMISSIONS if any permission is missing.
```

---

## 4. How to Add a Permission (Checklist)

Whenever a new protected endpoint or use-case is introduced, follow this 4-step checklist:

### Step 1: Naming Convention
Permissions follow the format: `resource:action[:scope]`, all lowercase, colon-separated:
- `resource`: Domain entity in kebab-case (e.g. `clinician-application`, `child-profile`, `user`).
- `action`: Verb describing the operation (e.g. `list`, `read`, `review`, `create`, `deactivate`).
- `scope` *(optional)*: Use `:self` only when the same action exists at both a self-service scope and an administrative/broad scope (e.g. `user:read:self` vs future `user:read:any`).

### Step 2: Declare in `PERMISSIONS`
Add the string literal to the `PERMISSIONS` tuple in `src/common/authz/permissions.ts`:
```typescript
export const PERMISSIONS = [
  // ... existing permissions
  'child-profile:create',
] as const;
```
Because the tuple is `as const`, the `Permission` TypeScript type updates automatically.

### Step 3: Grant in `ROLE_PERMISSIONS`
Assign the new permission to each role permitted to perform it in `ROLE_PERMISSIONS`:
- Use `SELF_PERMISSIONS` for actions common to all self-service roles (`PARENT`, `CLINICIAN`, `ADMIN`).
- Note: `ADMIN` spreads `...PERMISSIONS`, automatically receiving all declared permissions unless explicitly restricted.

### Step 4: Gate the Controller Handler
Annotate the controller handler with `@Auth('<permission>')`:
```typescript
@Post()
@Auth('child-profile:create')
@ApiOperation({ operationId: 'childProfileCreate', summary: 'Create a child profile' })
async create(...) { ... }
```

---

## 5. RBAC vs. Data Ownership

> [!IMPORTANT]
> **Data ownership is enforced in the service, NOT in the guard.**
> 
> The `PermissionsGuard` only verifies coarse-grained capabilities: *"Does a user with role PARENT have permission to update a child profile?"*
> 
> Fine-grained ownership (*"Is this specific child profile linked to this parent's account?"*) must be verified inline within the domain service:
> 1. Load the resource from PostgreSQL via `PrismaService`.
> 2. Compare the resource's owner ID with `currentUser.id`.
> 3. If they do not match, throw:
>    ```typescript
>    throw new ForbiddenException({
>      code: 'FORBIDDEN',
>      message: 'You do not have permission to access this resource',
>    });
>    ```

---

## 6. Decision notes

### `child:read` (Phase 4) — first role-diverging grant

Until Phase 4, `ROLE_PERMISSIONS` only ever added self-service permissions equally to
`PARENT`/`CLINICIAN` (via `SELF_PERMISSIONS`) plus `ADMIN`'s unconditional
`...PERMISSIONS` spread. `child:read` is the first permission granted to `PARENT` and
`CLINICIAN` individually for different reasons — a parent reads their **own** child, a
clinician reads a child they're **assigned to** — while `ADMIN` reads any child
unconditionally.

The guard only checks that the caller's role holds `child:read` at all. The actual
scoping happens in `GET /v1/children/{id}`'s service:
- `PARENT` → `child.parentId === currentUser.id`, else `403 FORBIDDEN`.
- `CLINICIAN` → a live `ClinicianChildAssignment` row for `(currentUser.id, child.id)`
  exists, else `403 FORBIDDEN`.
- `ADMIN` → no check.

This is a single existence/equality check per role — the same shape as the existing
"compare owner id to current user" pattern in §5, just checking a join-table row
instead of a direct FK. It does **not** trigger the `@casl/ability` migration note in
§7: that trigger is for genuinely compound/attribute conditions (e.g. "only if the
assignment is still active AND made within the last year"), not a single row lookup.

### `media:read` (Phase 5) — `child:read`-shaped, one hop further

Same precedent as `child:read` above, just walked from a `Media` row's `childId`
instead of a `Child` row's own `id`:
- `PARENT` → the media's child's `parentId === currentUser.id`, else `403 FORBIDDEN`.
- `CLINICIAN` → a live `ClinicianChildAssignment` row for `(currentUser.id, media.childId)`
  exists, else `403 FORBIDDEN`.
- `ADMIN` → no check.

`media:create:self` is narrower than `media:read` — only `PARENT` holds it (§2 of
[plan 0005](plans/0005-phase-5-media-upload.md)), and the service still checks the
caller is specifically *this child's* parent, not just any parent. Clinician/admin
media write access is explicitly deferred, not silently added here.

### `plan:manage` / `plan:read` (Phase 6) — `child:read`-shaped, walked from `Plan.childId`

Same existence-check precedent as `child:read`/`media:read` above, walked from a
`Plan` row's `childId`:
- `PARENT` (`plan:read` only — `PARENT` does not hold `plan:manage`) → the plan's
  child's `parentId === currentUser.id`, else `403 FORBIDDEN`.
- `CLINICIAN` → a live `ClinicianChildAssignment` row for
  `(currentUser.id, plan.childId)` exists, else `403 FORBIDDEN`. Checked on every
  `plan:manage` call (assign/complete/archive) and on `plan:read` (today's-focus).
- `ADMIN` → no check.

Still a single row-existence check, same as `child:read` — does not trigger the
`@casl/ability` migration note in §7.

### `plan-template:read` (Phase 6) — a new scoping *shape*: query filter, not existence check

Every ownership check so far (`child:read`, `media:read`, `plan:manage`/`plan:read`
above) answers "does this specific row belong to me." `plan-template:read` for
`CLINICIAN` answers a different question — "only show `PUBLISHED` rows":
- `CLINICIAN` → list and get queries add `where: { status: 'PUBLISHED' }`. Fetching a
  `DRAFT`/`ARCHIVED` template by id is `404 PLAN_TEMPLATE_NOT_FOUND`, not `403` — a
  clinician has no business knowing a non-published template exists at all.
- `ADMIN` → sees every status, no filter.

This is still a single, non-compound condition (`status = PUBLISHED`), so it does not
trigger the `@casl/ability` migration note in §7 — flagged here only because it is a
different *shape* of scoping than every prior decision note, worth naming so a future
reader doesn't assume all scoping is existence-checks.

### `plan-note:read` (Phase 6) — withheld from a role that already holds `plan:read` on the same `Plan`

`PlanNote` is clinician-to-clinician coordination ("what other clinicians suggested"),
not a parent-facing feature (§3 row 7 of
[plan 0006](plans/0006-phase-6-plan-domain.md)). `PARENT` holds `plan:read` but **not**
`plan-note:create`/`plan-note:read` — a parent can read a `Plan` and its "today's
focus," but not the notes clinicians leave on it. This is the first case in this
codebase where a role holding read access to a resource is deliberately denied read
access to a related sub-resource; noted here so it isn't "fixed" as an oversight later.
Scoping for `CLINICIAN`/`ADMIN` on both `plan-note:create` and `plan-note:read` is the
same existence-check shape as `plan:manage` above, walked from `PlanNote.planId` →
`Plan.childId`.

## 7. Future Migration Path to `@casl/ability`

The static map is intentionally designed as a strict subset of CASL. When business rules require **dynamic attribute-based conditions** (e.g., *"A clinician may read a session report only if the child is in their active caseload"*):

1. Keep `PERMISSIONS` as the action vocabulary.
2. Replace `ROLE_PERMISSIONS` with a CASL `AbilityFactory` (`createForUser(user)`).
3. Seed the `AbilityFactory` with the existing static grants so zero existing behavior regresses.
4. Update `PermissionsGuard` to evaluate `ability.can(action, subject)` where dynamic condition evaluation is needed.
5. All controller `@Auth('...')` decorators remain completely unchanged.

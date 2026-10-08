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
  'clinician:list',                // GET  /v1/clinicians — ADMIN only (provisioned CLINICIAN directory)
  'clinician:manage',              // POST/PATCH /v1/clinicians, POST /v1/clinicians/:id/resend-invitation — ADMIN only
  'child:create:self',             // POST /v1/children — PARENT only
  'child:read',                    // GET  /v1/children(/:id) — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'clinician-child:manage',        // POST /v1/children/:id/clinicians — ADMIN only
  'media:create:self',             // POST /v1/children/:id/media/upload-tickets, /v1/media/:id/confirm — PARENT only
  'media:read',                    // GET  /v1/children/:id/media — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'plan-template:manage',          // POST /v1/plan-templates(/:id/publish) — ADMIN only
  'plan-template:read',            // GET  /v1/plan-templates(/:id) — CLINICIAN(published-only)/ADMIN(any)
  'plan:manage',                   // POST /v1/children/:id/plans, /v1/plans/:id/(complete|archive) — CLINICIAN(assigned)/ADMIN
  'plan:read',                     // GET  /v1/children/:id/plans/today — PARENT(own)/CLINICIAN(assigned)/ADMIN(any)
  'plan-note:create',              // POST /v1/plans/:id/notes — CLINICIAN(assigned)/ADMIN
  'plan-note:read',                // GET  /v1/plans/:id/notes — CLINICIAN(assigned)/ADMIN — not PARENT
  'monthly-call:create',           // POST /v1/children/:childId/call-logs — CLINICIAN(assigned)/ADMIN
  'monthly-call:read',             // GET  /v1/children/:childId/call-logs — CLINICIAN(assigned)/ADMIN — not PARENT
  // Backend API completion (Phase 8):
  'user:manage-status',            // POST /v1/users/:id/(suspend|reactivate) — ADMIN only
  'user:list',                     // GET  /v1/users(/:id) — ADMIN only (general directory, all roles)
  'admin-summary:read',            // GET  /v1/admin/summary — ADMIN only
  'user:change-password:self',     // POST /v1/auth/change-password — PARENT/CLINICIAN/ADMIN (self)
  // Background job queue (Phase 11):
  'job:read',                      // GET  /v1/admin/jobs(/:id) — ADMIN only
  'job:manage',                    // POST /v1/admin/jobs/:id/requeue, /v1/admin/jobs/run-due — ADMIN only
  // Monthly call appointments (Phase 14):
  'appointment-slot:manage',       // POST /v1/appointment-slots — CLINICIAN(own)/ADMIN
  'appointment-slot:read',         // GET  /v1/children/:childId/appointment-slots — PARENT(own)/CLINICIAN(assigned)/ADMIN
  'appointment:create:self',       // POST /v1/children/:childId/appointments — PARENT (own child) only in practice
  'appointment:cancel:self',       // DELETE /v1/appointments/:id — PARENT (own child) only in practice
  'appointment:read',              // GET  /v1/children/:childId/appointments, /v1/appointments — PARENT(own)/CLINICIAN(assigned/own)/ADMIN
  // AI coaching tip (Phase 18):
  'ai-coaching:generate:self',     // POST /v1/children/:childId/ai-coaching-tips — PARENT (own child) only in practice
  'ai-coaching:read',              // GET  /v1/children/:childId/ai-coaching-tips/today — PARENT(own)/CLINICIAN(assigned)/ADMIN
  'ai-run:read',                   // GET  /v1/admin/ai/usage — ADMIN only
  'appointment:prepare:self',      // PUT  /v1/appointments/:id/preparation - PARENT (own child) only in practice
  'appointment:summarise',         // PUT  /v1/appointments/:id/summary - CLINICIAN(assigned)/ADMIN
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_PERMISSIONS: Permission[] = ['user:read:self', 'user:deactivate:self', 'user:change-password:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PARENT:    [...SELF_PERMISSIONS, 'child:create:self', 'child:read', 'media:create:self', 'media:read', 'plan:read'],
  CLINICIAN: [...SELF_PERMISSIONS, 'child:read', 'media:read', 'plan-template:read', 'plan:manage', 'plan:read', 'plan-note:create', 'plan-note:read', 'monthly-call:create', 'monthly-call:read'],
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
- `resource`: Domain entity in kebab-case (e.g. `clinician`, `child-profile`, `user`).
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

**Parent reads (plan 0009).** `GET /v1/plans/{id}` returns the plan's own content
(`days[]`, `sections[]`) to the child's parent, but `PARENT` is still not granted
`plan-template:read`, so the template stays unreachable by id; the plan endpoint is the
only door. The parent audience also gets redacted shapes: `PlanDto.createdById` and
`ClinicianChildAssignmentDto.assignedByAdminId` are omitted for `PARENT` (clinician and
admin shapes are unchanged).

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

### `monthly-call:create` / `monthly-call:read` (Phase 7) — withheld from `PARENT`, same shape as `plan-note`

Same non-obvious withholding as `plan-note:read` above: `MonthlyCallLog` records a
clinician's monthly check-in call with a child's parent, but the *log* itself is not a
parent-facing feature — it belongs to the same "clinician coordination" framing as
`PlanNote` (§3 row 3 of [plan 0007](plans/0007-phase-7-monthly-call-log.md)). `PARENT`
holds `child:read`/`media:read`/`plan:read` on the same child but neither
`monthly-call:create` nor `monthly-call:read` — noted here for the same reason as
`plan-note:read`, so it isn't "fixed" as an oversight later.

Scoping for `CLINICIAN`/`ADMIN` on both permissions is the same existence-check shape
as `media:read`, walked directly from `MonthlyCallLog.childId` (not through an
intermediate resource, since `MonthlyCallLog` hangs directly off `Child` like `Media`
does, not off `Plan` like `PlanNote` does):
- `CLINICIAN` → a live `ClinicianChildAssignment` row for
  `(currentUser.id, monthlyCallLog.childId)` exists, else `403 FORBIDDEN`.
- `ADMIN` → no check.

### `GET /v1/children` (`child:read`) — query-filter scoping, not an existence check

Added after Phase 7, closing a gap every prior phase individually deferred: nothing
let a `PARENT` discover its own child's id or a `CLINICIAN` discover its caseload
without already holding an id out-of-band. Reuses `child:read` (no new permission) —
same `plan-template:read`-shaped scoping (§6 above) as a `WHERE` filter rather than a
per-row check:
- `PARENT` → `where: { parentId: currentUser.id }`.
- `CLINICIAN` → `where: { clinicianAssignments: { some: { clinicianId: currentUser.id } } }`.
- `ADMIN` → unfiltered.

### `clinician:list` — admin-only directory + detail

`GET /v1/clinicians` lists `CLINICIAN` `User` rows (optional `?status=` / `?q=` filters) and
`GET /v1/clinicians/{id}` returns one with its profile and caseload. This feeds the
`POST /v1/children/{id}/clinicians` picker and the clinician management screen. The
`clinician-application:list` / `clinician-application:review` permissions were **removed in
Phase 10** together with the public application flow; clinicians are now created by an
admin (`clinician:manage`, below).

### `GET /v1/children/{childId}/clinicians` / `DELETE .../clinicians/{clinicianId}` (Phase 8) — reused permissions, no new grant

A1 reuses `child:read` — same ownership shape as `GetChildService` above, with one
addition: once a `CLINICIAN` is admitted (a live assignment for this child), they see
the child's **full** care team, not just their own row — same
"clinician-to-clinician coordination" framing as `plan-note:read`, just granting
visibility instead of withholding it. A2 reuses `clinician-child:manage` (the same
permission `POST /v1/children/{id}/clinicians` already uses) — ADMIN-only, no
ownership branch needed since the guard alone restricts it.

### `user:manage-status` (Phase 8) — new ADMIN-only permission, one grant covers two state transitions

Same precedent as `clinician:manage` (one permission, three routes) and
`plan-template:manage` (create+publish): `user:manage-status`
covers both `POST /v1/users/{id}/suspend` and `POST /v1/users/{id}/reactivate` rather
than minting one permission per transition. Granted only to `ADMIN` (not spread into
`SELF_PERMISSIONS`). Ownership/self-protection is enforced in
`SuspendUserService`, not the guard: suspending your own account is
`409 CANNOT_SUSPEND_SELF`, checked before the target row is even loaded, to prevent an
admin from locking themselves out. Suspend is valid from `ACTIVE`/`INVITED`;
reactivate is valid from `SUSPENDED`/`DEACTIVATED` — an invalid source status is
`409 INVALID_STATUS_TRANSITION`. Both are idempotent when the target is already in
the destination status (`200` + current state, not an error). Suspend calls
`RefreshTokenService.revokeAllForUser`, the same call `DeactivateService` already
makes — combined with `JwtAuthGuard` re-reading status on every request (§3 above),
this cuts off a suspended user's *existing* access token on its very next use, not
just future logins/refreshes.

### `GET /v1/children/{childId}/plans` / `GET /v1/plans/{id}` (Phase 8) — reused `plan:read`, closes the plan-history gap

Both reuse `plan:read` — no new permission. B2 is the same ownership shape as
`plan:manage`/`plan:read` above, walked straight from `Child` (every row in the
response already shares the requested `childId`, so there's no per-row check). B3
loads the `Plan` first (`404 PLAN_NOT_FOUND` if missing), then applies the identical
check against its `childId` — same precedent as `plan-note:read`'s two-hop walk, just
one hop. Before this phase, `today-focus` only ever returned the currently-`ACTIVE`
plan; a `COMPLETED`/`ARCHIVED` plan could never be retrieved again. These two routes
close that gap without changing who can see what — a `PARENT` who could already read
today's focus can now read the full history for the same reason.

### `POST /v1/auth/change-password` (Phase 8) — new self-scope permission, lives in `auth` not `users`

`user:change-password:self` joins `SELF_PERMISSIONS` (granted equally to
`PARENT`/`CLINICIAN`/`ADMIN`, same as `user:deactivate:self`). The route itself lives
in the `auth` module alongside `forgot-password`/`reset-password` — the same module
already owns every other password-mutation code path — even though every other `auth`
route is `@Public()`; this is the first authenticated route in that module. It reuses
`reset-password.service.ts`'s exact shape (verify → hash → persist →
`refreshTokens.revokeAllForUser`) and the existing `401 INVALID_CREDENTIALS` code
(same vocabulary as `login.service.ts`), not a new one. Covered by the existing
`/v1/auth/*` 5 req/60s throttle automatically — no new config.

### `user:list` (Phase 8) — new ADMIN-only permission, general directory across every role

Distinct from `clinician:list` (§6 above): `clinician:list` stays the narrow,
CLINICIAN-only feed that powers the assign-clinician picker. `user:list` is the
general admin directory across `PARENT`/`CLINICIAN`/`ADMIN` alike, covering both
`GET /v1/users` and `GET /v1/users/{id}` (same one-permission-two-routes precedent as
`user:manage-status` above). `UserSummaryDto`/
`UserDetailDto` are new DTOs, not a reuse of `UserProfileDto` (the self-service
`get-me` shape) — deliberately, to avoid over-exposing self-only fields to a response
shape not designed for admin oversight. `UserDetailDto` embeds relations (§3 row 11 of
plan 0008): a `PARENT`'s one child if any, or a `CLINICIAN`'s live
`ClinicianChildAssignment` rows — the "identity resolution gap" the phase-8 audit
flagged. No ownership branch needed; the guard alone restricts both routes to `ADMIN`.

### `POST /v1/plan-templates/{id}/archive` (Phase 8) — reused `plan-template:manage`

Same precedent as `PublishPlanTemplateService`: one permission already covers create +
publish; archive joins it rather than minting a new one. Valid from `DRAFT` or
`PUBLISHED`; idempotent if already `ARCHIVED`. No un-archive route — this is a
terminal state, same as `PlanStatus.ARCHIVED`/`COMPLETED`.

### `admin-summary:read` (Phase 8) — new ADMIN-only permission, the one genuinely new module

`GET /v1/admin/summary` returns a fixed flat shape (§3 row 12 of plan 0008) — six
independent `COUNT` queries against already-indexed columns, not a generic analytics
endpoint. `src/modules/admin/` is the one genuinely new module this phase adds; it
owns no domain's writes, only reads across domains via `PrismaService` directly, same
"no repository layer" convention as every other feature module. No ownership branch
needed; the guard alone restricts it to `ADMIN`.

### `clinician:manage` (Phase 10) — new ADMIN-only permission, one grant covers create + update + resend

Same precedent as `user:manage-status` and `plan-template:manage`: one permission
covers `POST /v1/clinicians`, `PATCH /v1/clinicians/{id}` and
`POST /v1/clinicians/{id}/resend-invitation`. Granted only to `ADMIN` (never spread
into a non-admin role). `GET /v1/clinicians/{id}` reuses `clinician:list` — it is a read
of the same directory, not a new capability. No ownership branch: the guard alone
restricts it, and clinician profile data is admin-only (parents never see it).
Activate/deactivate deliberately reuses `user:manage-status` (`/users/{id}/suspend`,
`/reactivate`) instead of adding clinician-specific routes.

**Lifecycle rules enforced in services, not the guard:**

- Suspending or self-deactivating a user consumes their outstanding `ACCOUNT_SETUP`
  tokens, and `complete-account-setup` requires `status = INVITED` — a suspended invitee
  cannot re-activate themselves with an old link.
- Reactivating a user with no password (suspended while `INVITED`) restores `INVITED`,
  not `ACTIVE`; the admin then resends the invitation.
- `POST /v1/children/{id}/clinicians` only accepts an `INVITED` or `ACTIVE` clinician
  (`409 CLINICIAN_NOT_ACTIVE` otherwise) — `INVITED` so an admin can pre-assign.
- A clinician's email can change only while `INVITED` (`409 CLINICIAN_EMAIL_LOCKED`).

### `job:read` / `job:manage` (Phase 11) — new ADMIN-only permissions, plus the one `@Public()` machine route

`GET /v1/admin/jobs(/{id})` needs `job:read`; `POST /v1/admin/jobs/{id}/requeue` and
`POST /v1/admin/jobs/run-due` need `job:manage`. Both are granted to `ADMIN` only (via the
`...PERMISSIONS` spread — never added to a non-admin role). No ownership branch: the guard
alone restricts them. Job payloads carry no secrets by construction, so the admin view
includes `payload`; the internal `lockedBy` instance id is not exposed.

**Documented exception to "every handler has an `@Auth`":** `POST /v1/jobs/run-due` (machine
trigger for an external cron/pinger) is `@Public()` **plus** `JobsTokenGuard`, which compares
the `X-Jobs-Token` header to `JOBS_RUN_TOKEN` in constant time. There is no user to
authenticate. Unset `JOBS_RUN_TOKEN` (the default) → the route returns `404`; a wrong or
missing header → `401 INVALID_JOBS_TOKEN`. The global throttler still applies.

### `consent:*` and `coaching:*` (Phase 12)

- `consent:read` (PARENT, ADMIN) and `consent:manage:self` (PARENT). **Clinicians are
  deliberately excluded** from consent (least privilege; add later if a screen needs it).
  Scoping is in the service: a PARENT must be the child's own parent. `ADMIN` holds
  `consent:manage:self` through the `...PERMISSIONS` spread, but the grant/withdraw
  services reject any caller who is not the child's parent (`403 FORBIDDEN`) — consent is
  the parent's own record, so admin can read but not alter it.
- `coaching:manage` (CLINICIAN, ADMIN) and `coaching:read` (PARENT, CLINICIAN, ADMIN).
  Scoping is the `child:read` shape: parent-own, clinician-assigned (via the plan's child),
  admin-any. Authoring is open to the assigned clinician as well as admin (plan 0012,
  resolved 2026-10-04) — easy to narrow later. The parent-facing coaching response is
  redacted: no `authorId`.

### `progress:*` (Phase 13)

- `progress:write:self` (PARENT) and `progress:read` (PARENT, CLINICIAN, ADMIN). Scoping is
  the `media:read` shape, enforced by `assertChildProgressAccess` in the service: parent-own,
  clinician-assigned, admin-any for reads. **Clinicians and admins are read-only**: ADMIN
  holds `progress:write:self` through the `...PERMISSIONS` spread, but the upsert service
  rejects any caller who is not the child's own parent (`403 FORBIDDEN`) — progress is the
  parent's own log, same stance as consent.

### `appointment-slot:*` / `appointment:*` (Phase 14)

- `appointment-slot:manage` (CLINICIAN, ADMIN). A CLINICIAN publishes **only their own** slots
  (`clinicianId` omitted or equal to the caller, else `403 FORBIDDEN`); an ADMIN must name the
  clinician (`400 CLINICIAN_ID_REQUIRED`). The target must be an ACTIVE clinician
  (`409 CLINICIAN_NOT_ACTIVE`). Enforced in `CreateSlotService`.
- `appointment-slot:read` (PARENT, CLINICIAN, ADMIN). Access is the `child:read` shape
  (`assertChildAppointmentReadAccess`: parent-own, clinician-assigned, admin-any). The result is then
  a **query filter** (the `GET /v1/children` shape): free, future slots whose clinician is ACTIVE
  and assigned to this child. A slot of an unassigned clinician is therefore simply absent.
- `appointment:create:self` (PARENT). ADMIN holds it through the `...PERMISSIONS` spread, so
  `CreateAppointmentService` restricts booking to the child's own parent (`403 FORBIDDEN` for
  anyone else, admin included — same stance as `progress:write:self`). A slot whose clinician is not
  assigned to the child (or is not ACTIVE, or is already in the past) is `404 SLOT_NOT_FOUND`, so slot
  existence is not disclosed across care teams.
- `appointment:cancel:self` (PARENT). ADMIN holds it through the spread, so `CancelAppointmentService`
  restricts cancelling to the child's own parent (`403 FORBIDDEN` otherwise). A call that has already
  started is `409 APPOINTMENT_STARTED`; success deletes the booking and frees the slot (`204`).
- `appointment:read` (PARENT, CLINICIAN, ADMIN). `GET /v1/children/{childId}/appointments` is the
  `child:read` shape (parent-own, clinician-assigned, admin-any). `GET /v1/appointments` is a query
  filter: CLINICIAN → appointments on their **own** slots, PARENT → their own child's, ADMIN → all.

- `appointment:prepare:self` (PARENT). ADMIN holds it through the spread, so `SavePreparationService` restricts it to the child's own parent (`403 FORBIDDEN` otherwise); a call that has already ended is `409 APPOINTMENT_ENDED`.
- `appointment:summarise` (CLINICIAN, ADMIN). A clinician must be assigned to the child (`403` otherwise); before the call starts it is `409 APPOINTMENT_NOT_STARTED`. The summary and action points are then returned to the parent on the appointment.

### Parent-app integration permissions (Phase 17)

| Permission | Roles | Where scope is enforced |
|---|---|---|
| `user:update:self` | every role | self only (`PATCH /users/me` takes the caller's id) |
| `child:update:self` | PARENT | service: caller must be the child's parent (ADMIN reaches the permission via the spread but is refused) |
| `child-clinical-profile:manage` | CLINICIAN, ADMIN | service: clinician must be assigned to the child |
| `activity:complete:self` | PARENT | `assertChildAccess(..., 'parent-write')`: only the child's own parent; clinicians/admin are read-only |
| `escalation:create:self` | PARENT | `parent-write`; one active request per child (partial unique index) |
| `escalation:read` | PARENT, CLINICIAN | `read` scope |
| Preferences (`GET`/`PATCH /users/me/preferences`) | every role | self only; read uses `user:read:self`, write uses `user:update:self` |
| `escalation:manage` | CLINICIAN, ADMIN | clinician works only requests of assigned children (queue is query-filtered) |

AI analyses and the assistant chat are deliberately not part of the backend yet (client decision, 2026-10-08);
the Parent app shows them as static UI until the AI work is scheduled.
The one exception is the parent AI coaching tip below (plan 0018), which ships dark behind `AI_ENABLED=false`.

### `ai-coaching:*` / `ai-run:read` (Phase 18)

- `ai-coaching:generate:self` (PARENT). ADMIN holds it through the `...PERMISSIONS` spread, so
  `AiAccessService.assertCanGenerate` rejects any caller who is not the child's own parent
  (`403 FORBIDDEN`) — same stance as `progress:write:self`. Admin and clinician *read* what the
  parent was told (clinician audit) but cannot trigger provider spend.
- `ai-coaching:read` (PARENT, CLINICIAN, ADMIN). The `child:read` shape, enforced by calling
  `GetChildService.getById` with the real caller (parent-own, clinician-assigned, admin-any,
  `404 CHILD_NOT_FOUND`). No new ownership code: any future fix to those rules applies to AI too.
- `ai-run:read` (ADMIN only, via the spread — no role list names it). Aggregate usage and cost
  for the current Pacific day; never prompts, inputs or outputs.
- `AiAccessService.assertCanGenerate` is the single choke point for the `AI_ENABLED` flag, role and
  ownership, and where a parental AI-processing consent check would go (plan 0018 O-1).
- The background job re-checks authorization at run time, as the requesting user, and aborts if
  that user is no longer `ACTIVE`: access is never trusted from enqueue time.

## 7. Future Migration Path to `@casl/ability`

The static map is intentionally designed as a strict subset of CASL. When business rules require **dynamic attribute-based conditions** (e.g., *"A clinician may read a session report only if the child is in their active caseload"*):

1. Keep `PERMISSIONS` as the action vocabulary.
2. Replace `ROLE_PERMISSIONS` with a CASL `AbilityFactory` (`createForUser(user)`).
3. Seed the `AbilityFactory` with the existing static grants so zero existing behavior regresses.
4. Update `PermissionsGuard` to evaluate `ability.can(action, subject)` where dynamic condition evaluation is needed.
5. All controller `@Auth('...')` decorators remain completely unchanged.

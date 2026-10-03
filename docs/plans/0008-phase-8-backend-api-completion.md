# Plan 0008 — Phase 8: Backend API Completion

Status: **Done**
Owner: backend
Last updated: 2026-10-01

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet** —
> this doc was authored ahead of the coding session per this repo's convention (plan
> doc before code), same as every prior phase plan in this directory.
>
> This phase closes gaps identified by a two-pass API/application-surface audit (one
> pass by this assistant, one independent second-opinion pass) run after Phase 7. It
> does **not** revisit Phases 1–7's decisions and is not another architecture audit —
> implementation sessions against this doc should build what's specified here, and
> only stop to re-litigate if they hit a concrete contradiction with current code.

---

## 1. Context

Phases 1–7 (all Done) shipped auth/onboarding, clinician application review, the Core
Care Domain (`Child`, `ClinicianChildAssignment`, `Media`, `Plan`/`PlanTemplate`/
`PlanNote`), and the monthly call log. Every write is scoped to a specific actor and
every read has an ownership/assignment check — the authz *model* is sound. The audit
found the gaps are in **surface completeness**, not in that model:

- An assignment, once made, can never be removed via the API.
- A user, once created, can never be suspended/reactivated via the API short of a
  manual DB edit — for a product handling children's video, this is more than a UI
  gap, it's an incident-response gap.
- No plan history — `plans/today` only ever returns the *currently active* plan; once
  `COMPLETED`/`ARCHIVED`, a plan can never be retrieved again.
- `MediaDto` returns a raw, deterministically-guessable Cloudinary `storageKey`
  instead of a mediated playback URL.
- No general admin user/parent directory (`GET /v1/clinicians` only returns
  provisioned `CLINICIAN` rows).
- The parent app has no way to change a password once authenticated (only the
  unauthenticated forgot/reset flow exists).

**Out of scope — must not be scaffolded here:** anything from the Core Care Domain's
standing out-of-scope list (unchanged since Phase 4) — no AI-pipeline persistence, no
goal-tracking/scoring/reporting, no dynamic/database-backed RBAC (§7 of `rbac.md`
still applies — nothing here triggers the `@casl/ability` migration), no new Prisma
models, no stored procedures/views/functions/materialized views, no Redis or generic
caching framework. `docs/plans/0007`'s closing note said no further phase was scoped
without a fresh scoping conversation — this phase **is** that fresh scoping
conversation, resolved via the audit above.

## 2. Scope

**In** (see §5 for the full endpoint table):

- Schema: **zero new tables.** `UserStatus.SUSPENDED` already exists, unused until
  now. Everything else reuses an existing model/enum/join row as-is.
- Permissions: four new — `user:manage-status`, `user:list`, `admin-summary:read`,
  `user:change-password:self`. Everything else reuses an existing permission (see §3
  row 1 for the full reuse map).
- Nine endpoints across four batches (Batch 1 security/access-lifecycle, Batch 2
  parent/clinician application surface, Batch 3 admin discovery, Batch 4 admin
  summary), plus one infrastructure change with no new route (Batch 2's media
  playback mechanism).
- Tests alongside every slice; e2e coverage for the same assigned/non-assigned/
  cross-parent isolation shape as every prior phase, **plus** new "access was actually
  revoked live" assertions for the two lifecycle endpoints (A2, A3) — see §7.
- Doc updates: `rbac.md` (new permissions + decision notes), `api-conventions.md` (the
  bounded-list-no-pagination exception, the media playback-URL contract), this file,
  `docs/plans/README.md`.

**Out:**

- `docs/plans/0008`'s own D2 (ETag/conditional-GET) is **conditional**: implement only
  if it is a small, isolated change that doesn't delay the batches above; otherwise
  leave deferred. Not scoped in detail here — see §6.
- Soft-delete/audit-trail column on `ClinicianChildAssignment` (e.g. `revokedAt`) —
  A2 is a hard delete; nothing currently reads historical assignment state, so this
  would be speculative. Revisit only if a screen needs "who was assigned when."
- Dynamic/per-admin permission grants (admin roles with different capability subsets)
  — out of scope per the second-opinion review; the current fixed
  `PARENT`/`CLINICIAN`/`ADMIN` model is unchanged.
- Any parent/clinician/admin **frontend** work — backend only.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Permission reuse map | A1→`child:read`, A2→`clinician-child:manage`, A3→**new** `user:manage-status`, B1→`media:read` (no permission change), B2/B3→`plan:read`, B4→**new** `user:change-password:self`, C1→**new** `user:list`, C2→`plan-template:manage`, D1→**new** `admin-summary:read`. Reuse follows existing precedent: one permission already covers multiple lifecycle actions elsewhere (`clinician-application:review` = approve+reject, `plan-template:manage` = create+publish) — new endpoints on an existing resource's lifecycle reuse that resource's permission rather than minting a new one per route. |
| 2 | A1 (`GET /v1/children/{childId}/clinicians`) ships before A2 (revoke) | You need a way to discover a `clinicianId` for a child before a revoke endpoint is useful — nothing today returns one. |
| 3 | A1 response has **no pagination** | A child's care team is bounded by business rule (a handful of clinicians, not an unbounded-over-time list like plan history). Plain array response. Document as a named exception in `api-conventions.md`, same treatment as the existing action-path exception. |
| 4 | A1 care-team visibility: any clinician assigned to the child sees the **full** care team, not just their own row | Same "clinician-to-clinician coordination" framing already established for `plan-note:read`. Confirm with product before shipping A1 if this needs to be narrower — default is full visibility. |
| 5 | A2 is a **hard delete**, idempotent | Child must exist (`404 CHILD_NOT_FOUND` if not); if the assignment row doesn't exist or was already revoked, still `204` — deleting something already gone is success, not an error, per `api-conventions.md`'s DELETE semantics. No `revokedAt` column (see §2 Out). |
| 6 | A3: one permission, two endpoints, self-suspend blocked | `user:manage-status` covers both `suspend` and `reactivate` (same precedent as row 1). Admin suspending their own account is `409 CANNOT_SUSPEND_SELF` — prevents lockout. `suspend` valid from `ACTIVE`/`INVITED`; `reactivate` valid from `SUSPENDED`/`DEACTIVATED` → `ACTIVE` (admin-reactivate can reverse a self-deactivation too, per `deactivate.service.ts`'s own doc comment anticipating this). Both idempotent in practice — repeating on an already-target-state user returns `200` with current state, not an error. Suspend revokes all refresh tokens (reuses `RefreshTokenService.revokeAllForUser`, same call `DeactivateService` already makes). |
| 7 | B1: hiding `storageKey` from the DTO alone is insufficient | `CloudinaryMediaStorageService.createUploadTicket` builds `storageKey`/Cloudinary `public_id` as `neuronest/{childId}/{mediaId}` — fully deterministic from two UUIDs any assigned clinician or the uploading parent already has. Today's uploads use Cloudinary's default **public** delivery type, so the URL was never actually secret — removing the field from JSON fixes the symptom, not the mechanism. Real fix is two-part: (a) upload-time — add `type: 'authenticated'` to the signed upload params (`createUploadTicket`) and to `verifyUpload`'s Admin API lookup, so the asset genuinely cannot be fetched unsigned; (b) read-time — a new `MediaStorageService.createPlaybackUrl(storageKey, type)` method, minted per-request, never persisted/cached, short TTL. |
| 8 | B1's exact TTL mechanism is confirmed at implementation time, not locked here | Cloudinary's `type: authenticated` + `sign_url: true` produces a signature-valid URL; genuine time-boxed auto-expiry needs the token-based-auth add-on, which may or may not be on the current account's plan tier. **Build-order step requires verifying this against the actual configured Cloudinary account before writing the implementation** — see §7 Batch 2 step 0. Fallback if the add-on isn't available: sign without a self-expiring token, rely on the response body itself being `no-store` and re-minted fresh on every list call, and flag the gap rather than claim an expiry that doesn't exist. |
| 9 | B2/B3 ownership is the same existence-check shape as `plan:manage`/`plan:read`, one/two hops from `Plan.childId` | No new scoping shape — B3 loads the `Plan` row first (`404 PLAN_NOT_FOUND` if missing) then applies the identical check against its `childId`. |
| 10 | C1 is distinct from, and does not replace, `GET /v1/clinicians` | `clinician:list` stays as-is (narrower, CLINICIAN-only, feeds the assign-clinician picker). `user:list` is the general admin directory across all roles. `UserSummaryDto`/`UserDetailDto` are new DTOs, not a reuse of `UserProfileDto` (the self-service `get-me` DTO), to avoid over-exposing self-only fields to an admin-directory response shape that wasn't designed for it. |
| 11 | C1 detail embeds relations, not just IDs | For a `PARENT`, embed `childId` (their one child, if any — `Child.parentId @unique` makes this a single optional field). For a `CLINICIAN`, embed `assignedChildIds: string[]` from their live `ClinicianChildAssignment` rows. This is the "identity resolution gap" the audit flagged — admin oversight screens need to resolve a bare UUID into something actionable. |
| 12 | D1's response is a fixed flat shape, not a generic analytics endpoint | `{ pendingClinicianApplications, activeClinicians, activeParents, activePlans, childrenWithAssignedClinician, childrenWithoutClinician }`. Every field is one `COUNT` query against already-indexed columns. No materialized view, no new index, at current data volume — revisit only if a specific query is measured slow. |
| 13 | B4 (change-password) lives in the `auth` module, not `users` | Authenticated action, but same module that already owns `forgot-password`/`reset-password` — keeps every password-mutation code path in one place rather than splitting credential logic across two modules. Route: `POST /v1/auth/change-password`, `@Auth('user:change-password:self')` (unlike the rest of `auth`'s routes, which are `@Public()`). Reuses `PasswordService.verify`/`.hash` and the exact `reset-password.service.ts` pattern: update `passwordHash`, then `refreshTokens.revokeAllForUser(userId)` — force re-authentication everywhere, including the current device, same as reset-password. Wrong current password reuses the existing `401 INVALID_CREDENTIALS` code (same vocabulary as login), not a new code. Covered by the existing `/v1/auth/*` rate limit (5 req/60s) automatically — no new throttle config. |
| 14 | D2 (ETag/conditional-GET) is conditional, not committed | Implement only if small and isolated enough not to delay Batches 1–4; otherwise leave deferred. If built, scope is narrow: a shared interceptor + `GET /v1/plan-templates(/{id})` and `GET /v1/clinicians` only — never applied to any Batch 1–3 endpoint, all of which are authorization-sensitive or mutate on a timescale that makes caching a net negative (caching is a representation optimization, never an authorization mechanism — authz is evaluated fresh on every request regardless of cache headers). |

## 4. Data model

**No schema changes. No migration.** Every endpoint below reads or writes columns/enum
values that already exist:

- `UserStatus.SUSPENDED` (schema.prisma:22) — declared, never set by any code path
  until A3.
- `ClinicianChildAssignment` — A1 reads it, A2 deletes a row from it. No column
  change.
- `Plan`, `PlanTemplate` — B2/B3/C2 read/transition existing rows. No column change.
- `Media.storageKey` — B1 stops *returning* it in `MediaDto`; the column itself is
  unchanged, still the only storage detail ever persisted.
- `User` — A3 writes `status`; C1 reads existing columns; B4 writes `passwordHash`
  (same column `reset-password` already writes).

If an implementation session finds a genuine need for a new column (e.g. a future
`revokedAt` on the assignment table), that's a scope change — stop and confirm before
migrating, don't fold it in silently.

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `GET` | `/v1/children/{childId}/clinicians` | `childClinicianList` | `@Auth('child:read')` | A1. No pagination (§3 row 3). Parent-own/clinician-assigned/admin-any, same shape as `GET /v1/children/{id}`. `404 CHILD_NOT_FOUND`. |
| `DELETE` | `/v1/children/{childId}/clinicians/{clinicianId}` | `childClinicianRevoke` | `@Auth('clinician-child:manage')` | A2. Admin only. `404 CHILD_NOT_FOUND` if child missing; `204` idempotent otherwise (§3 row 5). |
| `POST` | `/v1/users/{id}/suspend` | `userSuspend` | `@Auth('user:manage-status')` | A3. Admin only. `409 CANNOT_SUSPEND_SELF` on self-target. `200` + `{ id, status, updatedAt }`. Revokes all refresh tokens. |
| `POST` | `/v1/users/{id}/reactivate` | `userReactivate` | `@Auth('user:manage-status')` | A3. Admin only. Valid from `SUSPENDED` or `DEACTIVATED`. `200` + `{ id, status, updatedAt }`. |
| *(no new route)* | `MediaDto` shape change + `MediaStorageService.createPlaybackUrl` | — | — | B1. `GET /v1/children/{childId}/media` response: `storageKey` removed, `playbackUrl: string \| null` added (`null` unless `status === 'UPLOADED'`). See §3 rows 7–8. |
| `GET` | `/v1/children/{childId}/plans` | `planList` | `@Auth('plan:read')` | B2. `?status=&cursor=&limit=` (status optional). Cursor-paginated, `(createdAt desc, id desc)`. Same ownership shape as `plan:manage`. |
| `GET` | `/v1/plans/{id}` | `planGet` | `@Auth('plan:read')` | B3. Bare `PlanDto`. `404 PLAN_NOT_FOUND`. |
| `POST` | `/v1/auth/change-password` | `authChangePassword` | `@Auth('user:change-password:self')` | B4. Body `{ currentPassword, newPassword }`. `401 INVALID_CREDENTIALS` on wrong current password. `200` + `{ status: 'PASSWORD_CHANGED', updatedAt }`. Revokes all refresh tokens (forces re-login everywhere, including current device). |
| `GET` | `/v1/users` | `userList` | `@Auth('user:list')` | C1. `?role=&status=&cursor=&limit=` (both optional). `UserSummaryDto[]`. |
| `GET` | `/v1/users/{id}` | `userGet` | `@Auth('user:list')` | C1. `UserDetailDto` — embeds `childId` (PARENT) or `assignedChildIds` (CLINICIAN), per §3 row 11. `404 USER_NOT_FOUND`. |
| `POST` | `/v1/plan-templates/{id}/archive` | `planTemplateArchive` | `@Auth('plan-template:manage')` | C2. Admin only. Valid from `DRAFT` or `PUBLISHED`. `200` + `{ id, status: 'ARCHIVED', updatedAt }`. Idempotent. |
| `GET` | `/v1/admin/summary` | `adminSummaryGet` | `@Auth('admin-summary:read')` | D1. Fixed flat shape, §3 row 12. New `admin` module. |

Shared/new DTOs: `UserSummaryDto`, `UserDetailDto` (`src/modules/users/shared/`) for
C1. `MediaDto` modified in place (`src/modules/media/shared/`) for B1. Every other
endpoint reuses an existing shared DTO (`ClinicianChildAssignmentDto`, `PlanDto`)
unmodified.

## 6. Cross-cutting

- **Authz** — four new permissions (§3 row 1) declared in
  `src/common/authz/permissions.ts`; `user:change-password:self` joins
  `SELF_PERMISSIONS` (granted equally to `PARENT`/`CLINICIAN`/`ADMIN`, same as
  `user:deactivate:self`). `rbac.md` §6 gets one decision note per new permission —
  reuse the existing notes' structure, cross-reference rather than re-derive
  reasoning that's already written (e.g. A1/A2/B2/B3's ownership shape should point
  at the existing `child:read`/`plan:manage` notes, not restate them).
- **Pagination** — A1 deliberately has none (§3 row 3, needs an `api-conventions.md`
  addition documenting the exception). B2, C1 reuse `src/common/pagination/` exactly
  as every other list endpoint does — no changes to that module.
- **OpenAPI** — nine new `EXPECTED` rows in `test/docs.e2e-spec.ts` (A1, A2, A3×2, B2,
  B3, B4, C1×2, C2, D1 — eleven total; B1 adds none, it's a response-shape change on
  an existing route).
- **`rbac-route-coverage.e2e-spec.ts`** — every new handler needs its `@Auth(...)`
  present or the coverage guard fails; nothing here is `@Public()`.
- **Module wiring** — A1/A2 land in the existing `children` module; A3/C1 in the
  existing `users` module; B2/B3/C2 in the existing `plans` module; B1 touches `media`
  module files in place; B4 in the existing `auth` module; D1 is the one genuinely new
  module, `src/modules/admin/`, registered in `app.module.ts` — legitimate here
  because it owns no domain's writes, only reads across domains via `PrismaService`,
  same as any other feature slice.
- **`MediaStorageService` interface change** — new abstract method
  `createPlaybackUrl(storageKey: string, type: MediaType): Promise<{ url: string; expiresAt: string | null }>`
  (nullable `expiresAt` per §3 row 8's fallback). Both the real
  `CloudinaryMediaStorageService` and the test fake need it implemented — check
  `cloudinary-media-storage.service.spec.ts` for the fake's current shape before
  adding.
- **`truncateAll()`** (`prisma.service.ts`) — **no change**, no new tables.
- **No new throttle config** — B4 inherits `/v1/auth/*`'s existing 5 req/60s via
  `@AuthThrottle()`, same decorator every other auth route already carries.

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Security/access lifecycle

- [x] **1.0** Confirm §3/§5 drafts for A1–A3 against current `src/modules/children/`
  and `src/modules/users/` (closest precedents: `list-media.service.ts` for the
  existence-check shape, `deactivate.service.ts` for the status-transition +
  token-revocation shape). Adjust this doc if reality has drifted since
  2026-09-30.
- [x] **1.1** A1 `GET /v1/children/{childId}/clinicians` — feature folder under
  `children/features/list-clinician-assignments/` (or similar), reusing
  `ClinicianChildAssignmentDto`; `docs.e2e-spec.ts` row.
- [x] **1.2** A2 `DELETE /v1/children/{childId}/clinicians/{clinicianId}` — feature
  folder under `children/features/revoke-clinician-assignment/`; `docs.e2e-spec.ts`
  row.
- [x] **1.3** A3 permission `user:manage-status` in `permissions.ts` + `rbac.md` note.
- [x] **1.4** A3 `POST /v1/users/{id}/suspend` and `POST /v1/users/{id}/reactivate` —
  feature folders under `users/features/suspend-user/` and
  `users/features/reactivate-user/`; `docs.e2e-spec.ts` rows ×2.
- [x] **1.5** e2e: extend `test/child-care-domain.e2e-spec.ts` (A1/A2) and
  `test/deactivate.e2e-spec.ts` or a new `test/user-status.e2e-spec.ts` (A3) per §
  "Testing" below.
- [x] **1.6** Verify: `npm run lint && npm test && npm run build && npm run test:e2e`
  green before starting Batch 2.

### Batch 2 — Parent/clinician application surface

- [x] **2.0** **Before writing any Cloudinary code**, verify against the actual
  configured Cloudinary account/SDK whether `type: 'authenticated'` delivery +
  signed-URL expiry (token-auth add-on) is actually available on this account's plan
  tier. Do not assume it — confirm via Cloudinary's dashboard/API for the configured
  `cloudName`, or via `cloudinary.api.*` calls. If unavailable, implement the §3 row 8
  fallback and say so explicitly in the implementation summary, don't silently claim
  an expiry that isn't real.
- [x] **2.1** B1 `MediaStorageService.createPlaybackUrl` — add to the abstract class,
  implement in `CloudinaryMediaStorageService`, implement/stub in the test fake.
  Update `createUploadTicket` + `verifyUpload` to use `type: 'authenticated'`.
- [x] **2.2** B1 `MediaDto` — remove `storageKey`, add `playbackUrl`; update
  `ListMediaService`/`CreateUploadTicketService` call sites.
- [x] **2.3** B2 `GET /v1/children/{childId}/plans` — feature folder under
  `plans/features/list-plans/`; `docs.e2e-spec.ts` row.
- [x] **2.4** B3 `GET /v1/plans/{id}` — feature folder under `plans/features/get-plan/`;
  `docs.e2e-spec.ts` row.
- [x] **2.5** B4 permission `user:change-password:self` in `permissions.ts` (added to
  `SELF_PERMISSIONS`) + `rbac.md` note.
- [x] **2.6** B4 `POST /v1/auth/change-password` — feature folder under
  `auth/features/change-password/`, mirroring `reset-password`'s service shape;
  `docs.e2e-spec.ts` row.
- [x] **2.7** e2e: extend `test/media-upload.e2e-spec.ts` (B1 — explicitly assert
  `storageKey` absent from every response body, not just that `playbackUrl` is
  present), `test/plan-domain.e2e-spec.ts` (B2/B3), and `test/auth.e2e-spec.ts` (B4 —
  wrong-current-password, successful change kills other sessions, rate limit applies).
- [x] **2.8** Verify: full test/lint/build suite green before starting Batch 3.

### Batch 3 — Admin discovery

- [x] **3.0** Confirm §3 rows 10–11 against current `src/modules/users/` and
  `src/modules/clinicians/features/list-clinicians/` (closest precedent for the
  list+detail shape).
- [x] **3.1** C1 permission `user:list` in `permissions.ts` + `rbac.md` note.
- [x] **3.2** C1 `UserSummaryDto`/`UserDetailDto` in `users/shared/`.
- [x] **3.3** C1 `GET /v1/users` and `GET /v1/users/{id}` — feature folders under
  `users/features/list-users/` and `users/features/get-user/`; `docs.e2e-spec.ts`
  rows ×2.
- [x] **3.4** C2 `POST /v1/plan-templates/{id}/archive` — feature folder under
  `plans/features/archive-plan-template/`; `docs.e2e-spec.ts` row.
- [x] **3.5** e2e: new `test/user-directory.e2e-spec.ts` (or extend an existing users
  suite) for C1; extend `test/plan-domain.e2e-spec.ts` for C2.
- [x] **3.6** Verify: full test/lint/build suite green before starting Batch 4.

### Batch 4 — Admin summary (+ optional D2)

- [x] **4.0** D1 permission `admin-summary:read` in `permissions.ts` + `rbac.md` note.
- [x] **4.1** D1 new `src/modules/admin/` module + `features/get-summary/`; register in
  `app.module.ts`; `docs.e2e-spec.ts` row.
- [x] **4.2** e2e/unit: counts service unit test with seeded fixtures; one e2e smoke
  test for the route + non-admin `403`.
- [ ] **4.3** **Only if trivial and isolated**: D2 shared conditional-GET interceptor,
  applied narrowly to `GET /v1/plan-templates(/{id})` and `GET /v1/clinicians`. If it
  risks delaying the phase, skip and leave `docs/plans/0008` §3 row 14 as the record
  that it was deliberately deferred, not missed.
- [x] **4.4** Final verify: `npm run lint && npm test && npm run build && npm run test:e2e`
  green.
- [x] **4.5** Doc pass: `rbac.md` (all new-permission notes present), `api-conventions.md`
  (A1's no-pagination exception, B1's media playback contract), `docs/plans/README.md`
  row flipped to reflect this file's final status, this file's own Status flipped to
  **Done**.
- [x] **4.6** Write the implementation summary (see "Testing"/handoff requirements
  below) — every changed file, every endpoint, every permission, migrations (none
  expected), tests executed, any unresolved issue (e.g. if D2 was deferred or B1's
  TTL mechanism hit the §3 row 8 fallback).

## Testing (applies across all batches)

For every endpoint implemented in this phase:

- Add/update a co-located unit spec where the service has non-trivial logic (status
  transitions, ownership checks, playback-URL minting).
- Add/update e2e coverage: parent isolation, clinician-assignment isolation, admin
  unconditional access, and — where applicable — that a revoked/suspended actor
  **immediately** loses access (not just that the mutation endpoint itself succeeded).
- Update `test/docs.e2e-spec.ts` (authoritative route list) and
  `test/rbac-route-coverage.e2e-spec.ts` for every new route.
- Do not weaken or delete any existing passing test to make a new one pass.

**A2 specifically**: after revocation, assert the affected clinician gets `403` on
that child's `child:read`, `media:read`, `plan:read`, and `monthly-call:read` — all
four, in the same test, immediately after the revoke call. This is the assertion that
actually matters; a passing revoke call with no follow-up access check would miss the
entire point of the endpoint.

**A3 specifically**: assert, in order — suspend revokes the user's refresh token(s);
a subsequent authenticated request with the old access token still works until it
naturally expires but a token *refresh* attempt fails (`401`); a fresh login attempt
fails (`403 ACCOUNT_NOT_ACTIVE`, matching `login.service.ts`'s existing check); admin
reactivates; login works again; an admin attempting to suspend their own account gets
`409`; a non-admin caller gets `403` on both `suspend` and `reactivate`.

## 8. How to resume

> Nothing is implemented yet. This plan was written and approved in a prior session;
> the next session's job is to **build it**, batch by batch, in the order above —
> not to re-audit or redesign the API surface. Start at Batch 1, step 1.0.
>
> Closest precedents to mirror, per batch: Batch 1 → `list-media.service.ts` (existence-check
> ownership shape) and `deactivate.service.ts` (status-transition + token-revocation
> shape). Batch 2 → `reset-password.service.ts` (password-change + revoke-all-sessions
> shape, for B4) and `create-upload-ticket.service.ts`/`cloudinary-media-storage.service.ts`
> (for B1 — **verify the Cloudinary account's actual capabilities before writing the
> playback-URL code**, per §7 step 2.0, don't assume the token-auth add-on is
> available). Batch 3 → `list-clinicians.service.ts` (list+detail admin-directory
> shape). Batch 4 → any existing feature slice, for the one genuinely new module's
> internal structure.
>
> Keep the repository buildable after each batch (§7's verify steps are not optional
> — don't batch them all up for the end). At the end of the phase: run lint, unit
> tests, e2e tests, and build; update `rbac.md`/`api-conventions.md`/
> `docs/plans/README.md`/this file's Status; and produce an implementation summary
> listing every changed file, every endpoint, every permission added, any migration
> (none expected — flag it loudly if one turned out to be necessary), tests executed,
> and any unresolved issue (especially whether B1's playback-URL TTL hit the real
> mechanism or the documented fallback, and whether D2 was built or deferred).

## 9. Implementation summary (2026-10-01)

All four batches shipped except D2, which was deliberately deferred (§3 row 14 already
anticipated this outcome).

**Permissions added (4, exactly as scoped):** `user:manage-status`, `user:list`,
`admin-summary:read`, `user:change-password:self`. No other permission changed.

**Endpoints shipped (11, matching §5):**
- A1 `GET /v1/children/{id}/clinicians` — `children/features/list-clinician-assignments/`
- A2 `DELETE /v1/children/{id}/clinicians/{clinicianId}` — `children/features/revoke-clinician-assignment/`
- A3 `POST /v1/users/{id}/suspend` — `users/features/suspend-user/`
- A3 `POST /v1/users/{id}/reactivate` — `users/features/reactivate-user/`
- B2 `GET /v1/children/{childId}/plans` — `plans/features/list-plans/`
- B3 `GET /v1/plans/{id}` — `plans/features/get-plan/`
- B4 `POST /v1/auth/change-password` — `auth/features/change-password/`
- C1 `GET /v1/users` — `users/features/list-users/`
- C1 `GET /v1/users/{id}` — `users/features/get-user/`
- C2 `POST /v1/plan-templates/{id}/archive` — `plans/features/archive-plan-template/`
- D1 `GET /v1/admin/summary` — new `src/modules/admin/` module, `features/get-summary/`

**B1 (no new route, response-shape + mechanism change):**
- `MediaStorageService` gained `createPlaybackUrl(storageKey, type)`, implemented in
  `CloudinaryMediaStorageService` and `FakeMediaStorageService` (test helper).
- **Cloudinary capability check (§7 step 2.0) was actually run** against the
  configured account: `cloudinary.api.usage()` → `plan: "Free"`. Confirmed the
  token-based-authentication add-on is **not** available on this tier. Implemented
  the §3 row 8 fallback: `type: 'authenticated'` delivery + `sign_url: true`, which is
  signature-valid but does **not** self-expire — `createPlaybackUrl` honestly returns
  `expiresAt: null`. `createUploadTicket` and `verifyUpload` were updated to use
  `type: 'authenticated'` too, closing the actual security gap (assets were
  previously public-delivery, fetchable by anyone who could derive the deterministic
  `storageKey`).
- `MediaDto` gained `playbackUrl: string | null`. Note: `storageKey` was **already not
  exposed** in `MediaDto` before this phase — the plan's framing ("MediaDto returns a
  raw storageKey") didn't match current code; the underlying mechanism gap (public
  delivery type) was real and is what got fixed.
- `GET /v1/children/{id}/media` and `POST /v1/media/{id}/confirm` now send
  `Cache-Control: no-store` (playback URLs are minted fresh per request, never cached).

**Migrations: none**, as expected — no schema changes anywhere in this phase.

**Docs updated:** `docs/rbac.md` (canonical permissions block + one decision note per
new permission/reused-permission grouping), `docs/api-conventions.md` (bounded
non-paginated-list exception for A1, media playback-URL contract for B1), this file,
`docs/plans/README.md`.

**Tests:** every new service has a co-located unit spec. e2e coverage extended in
`test/child-care-domain.e2e-spec.ts` (A1/A2, including the four-permission
immediate-loss assertion after revoke), `test/media-upload.e2e-spec.ts` (B1),
`test/plan-domain.e2e-spec.ts` (B2/B3/C2), `test/auth.e2e-spec.ts` (B4, including the
rate-limit assertion). New files: `test/user-status.e2e-spec.ts` (A3, full
suspend/reactivate/self-block/idempotency/login-blocked matrix),
`test/user-directory.e2e-spec.ts` (C1), `test/admin-summary.e2e-spec.ts` (D1). Both
`test/docs.e2e-spec.ts` and `test/rbac-route-coverage.e2e-spec.ts` updated/passing for
every new route. Final verify green: `npm run lint && npm test && npm run build &&
npm run test:e2e` — 50 unit suites/205 tests, 13 e2e suites/172 tests, build clean.

**Unresolved / flagged items:**
1. **D2 (ETag/conditional-GET) was deferred**, not built — per §3 row 14's own
   conditional scope, it wasn't small/isolated enough to add risk-free this late in
   the phase. `docs/plans/README.md` and this file record it as a deliberate
   deferral, not a miss.
2. **B1's TTL hit the documented fallback**, not the real token-auth mechanism — see
   above. If the Cloudinary account is ever upgraded to a tier with the add-on,
   `CloudinaryMediaStorageService.createPlaybackUrl` is the only place that needs to
   change.
3. **One incidental fix, outside this phase's original scope but required to keep
   `npm run test:e2e` meaningful**: `test/jest-e2e.config.ts` now excludes a stray
   nested git worktree (`.kilo/worktrees/...`) from its test-file glob. That worktree
   was bleeding its own (stale) copy of `test/docs.e2e-spec.ts` into this repo's e2e
   run via `rootDir: '..'`'s recursive scan — unrelated to any phase-8 code, but it
   was making the verify step's pass/fail signal unreliable.
4. **A3's test narrative in this doc's own "Testing" section (§ above, A3-specifically)
   doesn't match actual `JwtAuthGuard` behavior**: it describes the pre-suspension
   access token as "still works until it naturally expires." In the current code,
   `JwtAuthGuard` already re-reads account status from the database on every request
   (this predates phase 8 — see `deactivate.e2e-spec.ts`), so a suspended user's
   existing access token is rejected on its very next use, not just on
   refresh/re-login. This is a stricter, already-established, and more correct
   behavior than the doc's narrative assumed — implemented and tested against the
   real (stricter) behavior rather than the doc's description, and flagged here per
   this session's kickoff instructions rather than silently resolved.

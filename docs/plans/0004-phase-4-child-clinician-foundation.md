# Plan 0004 — Phase 4: Child + Clinician↔Child Foundation

Status: **Done**
Owner: backend
Last updated: 2026-09-20

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code.

---

## 1. Context

Phase 1–2 shipped auth/onboarding and standards hardening; Phase 3 (admin review of
clinician applications, plan [0003](0003-phase-3-clinician-review.md)) is Done. The
product is entering Milestone A / MVP: parent app, clinician app, admin panel — UI/UX
foundations with plan/coaching content manually configured (no AI generation this
milestone). This phase stands up the first slice of the **Core Care Domain**: the
`Child` record itself and the clinician↔child assignment join, which every later
domain table (media, plans, call logs) hangs off of.

Locked business rules: one parent ↔ exactly one child; a child may have multiple
clinicians; strict per-child data isolation; the child never authenticates; clinicians
are `User`s who may work across multiple children.

**Out of scope — must not be scaffolded here** (later phases per the Milestone A
architecture note): `Media`/`MediaStorageService` (Phase 5), `PlanTemplate`/`Plan`/
`PlanNote` (Phase 6), `MonthlyCallLog` (Phase 7), any AI-pipeline persistence, a
platform-content/CMS table, a parent `WaitlistEntry` table, weekly/monthly
goal-tracking or scoring, a document/file-type registry, any admin/parent/clinician
frontend. No partial-unique-index enforcement of anything beyond what's stated below.

## 2. Scope

**In:**

- Schema: `Child` (unique `parentId` FK → `User`), `ClinicianChildAssignment`
  (many-to-many join `User`(CLINICIAN)↔`Child`, `@@unique([clinicianId, childId])`,
  `assignedByAdminId` audit FK). One migration. Relation fields added to `User`
  (additive only — no Phase 1–3 table touched beyond that).
- Permissions: `child:create:self`, `child:read`, `clinician-child:manage`.
- Endpoints: `POST /v1/children` (parent creates own child), `GET /v1/children/{id}`
  (parent/assigned-clinician/admin read, ownership enforced in service),
  `POST /v1/children/{id}/clinicians` (admin assigns a clinician).
- Tests alongside every slice; e2e isolation suite proving cross-parent and
  cross-clinician access is blocked; `test/docs.e2e-spec.ts` `EXPECTED` kept in sync.
- Doc updates: `schema-decisions.md`, `rbac.md`, `docs/plans/README.md`.

**Out:** anything in §1's out-of-scope list. No update/delete on `Child` (not needed
by any MVP screen yet — add when a screen needs it). No unassign endpoint (same
reasoning — `clinician-child:manage` today only covers create; extend when a screen
needs removal). No list-children-for-clinician / list-clinicians-for-child endpoints
yet (no UI consumer this phase; `GET /v1/children/{id}` is the only read shape needed
for "today's focus"-style screens once Phase 6 lands).

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | `Child.parentId` is a **unique** FK | DB-enforces "exactly one child per parent" from the child side; a second `POST /v1/children` by the same parent is a real conflict, not an upsert. |
| 2 | `child:read` is one permission for all three roles, ownership branches in the service | Mirrors the existing `user:read:self`/rbac.md §5 pattern (guard checks coarse capability, service checks the specific row). `PARENT` → `child.parentId === currentUser.id`; `CLINICIAN` → a live `ClinicianChildAssignment` row exists; `ADMIN` → unconditional. This is a single boolean existence/equality check per role, not a compound/attribute condition — it does not trigger the CASL migration note in `docs/rbac.md` §6. |
| 3 | Ownership/assignment failure on read is `403 FORBIDDEN` (not `404`) uniformly | Matches the exact `ForbiddenException({ code: 'FORBIDDEN', ... })` shape already documented in `rbac.md` §5. A missing id is `404 CHILD_NOT_FOUND` regardless of caller role, checked before the ownership branch. |
| 4 | `POST /v1/children/{id}/clinicians` is `ADMIN`-only via `clinician-child:manage`; no scope needed | Admin manages the join unconditionally (coarse role permission), per the resolved ownership-boundary table in the Milestone A architecture note. |
| 5 | Assigning a `clinicianId` that isn't a `CLINICIAN` `User`, or is already assigned, is a real error | `404 CLINICIAN_NOT_FOUND` (id doesn't resolve to a `CLINICIAN` user) / `409 CLINICIAN_ALREADY_ASSIGNED` (unique-constraint pre-check). |
| 6 | `dateOfBirth` stored as `@db.Date` (no time component) | A birthdate has no meaningful time-of-day; matches how it will be displayed everywhere. |
| 7 | New domain module `children`, not folded into `users` or `clinicians` | `Child` is a first-class domain distinct from both `User` roles that touch it; matches the "one module per domain" convention. |
| 8 | `assignedByAdminId` FK uses `onDelete: Restrict` | No admin-deletion flow exists yet; silently cascading an audit trail away if one is added later would be wrong. Explicit per the "every FK states its `onDelete`" convention. |

## 4. Data model

```prisma
model Child {
  id          String   @id @default(uuid()) @db.Uuid
  parentId    String   @unique @db.Uuid
  parent      User     @relation("ChildParent", fields: [parentId], references: [id], onDelete: Cascade)
  name        String
  dateOfBirth DateTime @db.Date
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  clinicianAssignments ClinicianChildAssignment[]

  @@map("children")
}

model ClinicianChildAssignment {
  id                String   @id @default(uuid()) @db.Uuid
  clinicianId       String   @db.Uuid
  clinician         User     @relation("ClinicianAssignments", fields: [clinicianId], references: [id], onDelete: Cascade)
  childId           String   @db.Uuid
  child             Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  assignedByAdminId String   @db.Uuid
  assignedByAdmin   User     @relation("AssignmentsMadeByAdmin", fields: [assignedByAdminId], references: [id], onDelete: Restrict)
  createdAt         DateTime @default(now())

  @@unique([clinicianId, childId])
  @@index([childId])
  @@map("clinician_child_assignments")
}
```

`User` gains three relation fields (additive, no column changes to `users`):
`child Child? @relation("ChildParent")`,
`clinicianAssignments ClinicianChildAssignment[] @relation("ClinicianAssignments")`,
`assignmentsMadeAsAdmin ClinicianChildAssignment[] @relation("AssignmentsMadeByAdmin")`.

One migration, `phase_4_child_clinician_foundation`. `prisma.service.ts`'s
`truncateAll()` gains `clinician_child_assignments` and `children` (truncated before
`users`, since both FK to it).

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/children` | `childCreate` | `@Auth('child:create:self')` | `201` + `ChildDto`; body `{ name, dateOfBirth }`; `409 CHILD_ALREADY_EXISTS` if caller already has one. |
| `GET` | `/v1/children/{id}` | `childGet` | `@Auth('child:read')` | `id` via `ParseUUIDPipe`; `404 CHILD_NOT_FOUND`; `403 FORBIDDEN` if not the parent, not an assigned clinician, and not admin. |
| `POST` | `/v1/children/{id}/clinicians` | `childAssignClinician` | `@Auth('clinician-child:manage')` | `201` + `ClinicianChildAssignmentDto`; body `{ clinicianId }`; `404 CHILD_NOT_FOUND` / `404 CLINICIAN_NOT_FOUND` / `409 CLINICIAN_ALREADY_ASSIGNED`. |

Shared response DTOs: `ChildDto` (`id, parentId, name, dateOfBirth, createdAt,
updatedAt`) and `ClinicianChildAssignmentDto` (`id, clinicianId, childId,
assignedByAdminId, createdAt`) in `src/modules/children/shared/`.

## 6. Cross-cutting

- **Authz** — three new permissions declared in `permissions.ts`; `ROLE_PERMISSIONS`
  now diverges per role for the first time beyond the `ADMIN`-spreads-everything
  pattern (`PARENT`: self + `child:create:self` + `child:read`; `CLINICIAN`: self +
  `child:read`; `ADMIN`: everything). Decision note added to `rbac.md` per its own
  checklist ("grant crosses a role boundary that isn't self-evident" + "permission
  implies data scoping the guard can't see").
- **OpenAPI** — each handler gets `@ApiOperation({ operationId })`,
  `@HttpCode` where not the method default, typed `@ApiCreatedResponse`/`@ApiOkResponse`.
  `test/docs.e2e-spec.ts` `EXPECTED` gets three new rows.
- **Module wiring** — new `ChildrenModule` (no cross-module import needed; only
  `PrismaService`), registered in `app.module.ts`.
- **Errors** — new stable codes: `CHILD_ALREADY_EXISTS` (409), `CHILD_NOT_FOUND` (404),
  `CLINICIAN_NOT_FOUND` (404), `CLINICIAN_ALREADY_ASSIGNED` (409); reuses `FORBIDDEN`
  (403) from the existing ownership pattern.

## 7. Build order (ordered checklist)

- [x] **0. Plan doc** — this file + `docs/plans/README.md` row (Active).
- [x] **1. Schema + migration** — `Child`, `ClinicianChildAssignment`, `User` relation
  fields; migration `20260920133427_phase_4_child_clinician_foundation`;
  `truncateAll()` updated; `schema-decisions.md` entries.
- [x] **2. Permissions** — `child:create:self`, `child:read`, `clinician-child:manage`
  declared + granted per §6; `rbac.md` decision note (§6 "Decision notes").
- [x] **3. `POST /v1/children`** — `ChildrenModule`, `shared/child.dto.ts`, feature
  folder (dto, controller, service, spec — 2 tests); registered in `app.module.ts`;
  `docs.e2e-spec.ts` row.
- [x] **4. `GET /v1/children/{id}`** — feature folder (spec — 6 tests); ownership
  branch per role; `docs.e2e-spec.ts` row.
- [x] **5. `POST /v1/children/{id}/clinicians`** — `shared/clinician-child-assignment.dto.ts`;
  feature folder (spec — 5 tests); `docs.e2e-spec.ts` row.
- [x] **6. Isolation e2e suite** — `test/child-care-domain.e2e-spec.ts` (12 tests):
  parent creates child, second create is `409`; owning parent reads `200`, a
  different parent `403`; a non-assigned clinician `403`; admin reads `200`
  unconditionally; unknown id `404`; admin assigns a clinician, that clinician then
  reads `200`; a still-unassigned clinician stays `403`; duplicate assignment `409`;
  assigning a non-clinician user id `404`; a non-admin assigning is `403`. All five
  test actors are seeded once in `beforeAll` (one `/v1/auth/login` call each) to stay
  under the 5 req/60s `/v1/auth/*` throttle — see the file's header comment.
- [x] **7. Verify** — `npm run lint` (clean) + `npm test` (71) + `npm run build`
  (clean) + `npm run test:e2e` (58) all green; flipped this plan and the
  `docs/plans/README.md` row to **Done**.

## 8. How to resume

> Phase 4 is **Done** — closed out 2026-09-20. All of §7 is checked;
> `npm run lint && npm test (71) && npm run build && npm run test:e2e (58)` are green.
> Migration `20260920133427_phase_4_child_clinician_foundation` is committed. The next
> phase (5 — media upload, `MediaStorageService` + `Media` model) builds on the `Child`
> model added here; author its own `docs/plans/0005-*.md` before writing code. Do not
> scaffold `Media`, `Plan`, or `MonthlyCallLog` in this plan's module.
>
> Runtime smoke (optional, `npm run start:dev`): seed a `PARENT` (signup+verify+login),
> `POST /v1/children`, `GET /v1/children/{id}` as that same parent → `200`; seed an
> `ADMIN` and a `CLINICIAN` directly via Prisma, `POST /v1/children/{id}/clinicians`
> as admin, then `GET /v1/children/{id}` as that clinician → `200`.

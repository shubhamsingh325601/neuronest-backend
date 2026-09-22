# Plan 0006 — Phase 6: Plan Domain (Templates, Assignment, Clinician Notes)

Status: **Done**
Owner: backend
Last updated: 2026-09-21

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet** —
> this doc was authored ahead of the coding session per this repo's convention (plan
> doc before code), mirroring exactly how [0005](0005-phase-5-media-upload.md) was
> authored ahead of Phase 5.

---

## 1. Context

Phase 4 shipped `Child` + `ClinicianChildAssignment`; Phase 5 shipped `Media` upload.
Both are Done. This phase adds the **Plan domain** — the coaching-content layer that
Milestone A's parent app ("Today's Focus" screen) and clinician app (assign/annotate a
plan) both need, with content **manually configured by admin** this milestone (no AI
generation — that's a future pipeline this schema leaves a seam for but does not
build).

Locked at the original Milestone A scoping round: **admin owns the reusable template
library; clinicians own how a template is applied and annotated per child.**
Clinicians actively manage plans for children they're assigned to (pick a template,
leave notes/suggestions visible to co-assigned clinicians) — not just review
admin-authored content. This is the resolved "plan ownership" question from that
round, and it's why this phase has three sub-resources instead of one.

The user has explicitly flagged a larger brain-dump — weekly/monthly goal tracking,
achievement scoring, a document-type registry, reporting — as **"too much for now."**
None of that is in this phase; see §1's out-of-scope list below, which repeats it
verbatim so it isn't silently reintroduced.

**Out of scope — must not be scaffolded here:**
`MonthlyCallLog` (Phase 7); any AI-pipeline persistence (`AIModelRun`, `PromptVersion`,
`Embedding`, `TokenUsage`, `BehaviorSignal`); weekly/monthly goal-tracking, achievement
scoring, or reporting/analytics tables; a document/file-type registry beyond what
`Media` (Phase 5) already covers; any admin/parent/clinician frontend; a partial-unique
-index enforcement of "one ACTIVE plan per child" (service-layer invariant only, same
deliberate-simplification reasoning as everywhere else in this domain); plan
deletion; a general plan-history list endpoint (only "today's focus" is scoped this
phase — add a full history list when a screen actually needs one).

## 2. Scope

**In:**

- Schema: `PlanTemplateStatus` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `PlanStatus`
  (`ACTIVE`/`COMPLETED`/`ARCHIVED`), `PlanOrigin` (`MANUAL`/`AI`, always `MANUAL` this
  milestone) enums; `PlanTemplate`, `PlanTemplateDay`, `Plan`, `PlanNote` models. One
  migration.
- Permissions: `plan-template:manage` (ADMIN), `plan-template:read`
  (CLINICIAN+ADMIN), `plan:manage` (CLINICIAN-assigned/ADMIN), `plan:read`
  (PARENT-own/CLINICIAN-assigned/ADMIN-any), `plan-note:create`
  (CLINICIAN-assigned/ADMIN), `plan-note:read` (CLINICIAN-assigned/ADMIN — **not**
  `PARENT`, see §3 row 7).
- Endpoints (see §5): create a template (with nested days), list/get templates,
  publish a template; assign a plan to a child, complete/archive a plan, "today's
  focus" read; create a plan note, list a plan's notes.
- Tests alongside every slice; e2e coverage for the assignment invariant (one
  `ACTIVE` plan per child), the publish gate (can't assign a `DRAFT` template), and
  the same cross-parent/cross-clinician isolation shape as Phases 4–5's suites.
- Doc updates: `schema-decisions.md`, `rbac.md`, `docs/plans/README.md`.

**Out:** everything in §1's out-of-scope list. No template versioning (editing a
`PUBLISHED` template's days is not supported this phase — publish is a one-way gate;
if content needs to change, admin creates a new template. Flag if this becomes a real
pain point rather than working around it here). No notification/email when a note is
left. No plan-note edit/delete (append-only thread, matches "working paper" framing).

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | A `PlanTemplate`'s days are created **nested, in one request**, not via separate day-by-day endpoints | `POST /v1/plan-templates` body includes `days: [{ dayNumber, title, instructions }]`, written in one `prisma.planTemplate.create({ data: { days: { create: [...] } } })`. Avoids N+1 admin-UI round trips for what is fundamentally one authoring action. Editing days after creation is out of scope this phase (see §2) — a `DRAFT` template can be deleted and recreated if content is wrong before publish. |
| 2 | Only a `PUBLISHED` template can be assigned to a child | Assigning a `DRAFT`/`ARCHIVED` template is `409 PLAN_TEMPLATE_NOT_PUBLISHED`. Mirrors the intent of Phase 3's `ClinicianApplicationStatus` terminal-state guards — a state gate enforced in the service, not the guard. |
| 3 | "At most one `ACTIVE` `Plan` per child" is a service-layer invariant, checked on create | Creating a `Plan` for a child that already has one `ACTIVE` is `409 PLAN_ALREADY_ACTIVE` — the caller must explicitly `complete`/`archive` the existing one first. No partial unique index (per the original architecture note's own deliberate-simplification call). |
| 4 | `Plan` status transitions are action-style endpoints, not a generic `PATCH` | `POST /v1/plans/{id}/complete` and `POST /v1/plans/{id}/archive` — matches the existing `approve`/`reject`/`publish` precedent in `docs/api-conventions.md` (a state transition with the "at most one ACTIVE" invariant attached, not a plain field edit). Both are idempotent no-ops if the plan is already in that target state; transitioning a plan that's already in the *other* terminal state is `409 PLAN_ALREADY_FINAL`. |
| 5 | `plan:manage` scoping for `CLINICIAN` requires a live `ClinicianChildAssignment` for the **target child** | Same existence-check shape as `child:read` (`docs/rbac.md` §6) — checked in the service on every create/complete/archive call, walking from `Plan.childId` (or the request's `childId` on create) to the assignment table. `ADMIN` unconditional. |
| 6 | `plan-template:read` scoping for `CLINICIAN` is a **query filter**, not an existence check | Unlike every other ownership check introduced so far (`child:read`, `media:read`, `plan:manage`), this one isn't "does this specific row belong to me" — it's "only show `PUBLISHED` rows." `CLINICIAN` list/get queries add `where: { status: 'PUBLISHED' }`; a `CLINICIAN` fetching a `DRAFT`/`ARCHIVED` template by id gets `404 PLAN_TEMPLATE_NOT_FOUND` (not `403` — a clinician has no business knowing a non-published template exists at all). `ADMIN` sees every status. This is a new *shape* of service-side scoping worth calling out in the `rbac.md` decision note, distinct from the existence-check shape — still a single, non-compound condition, so it still does not trigger the CASL migration note. |
| 7 | `PlanNote` is readable by assigned `CLINICIAN`s and `ADMIN` — **not** `PARENT` | The original architecture note frames `PlanNote` as clinician-to-clinician coordination ("the entire 'clinicians see what other clinicians suggested' requirement"), not a parent-facing feature. This is a real, non-obvious scoping choice (withholding something from a role that already holds `plan:read` on the same `Plan`) — flagged here per `docs/rbac.md`'s own checklist for when a decision note is mandatory, not just when it's convenient. |
| 8 | "Today's Focus" is a **computed** read, no new table | `GET /v1/children/{childId}/plans/today` finds the child's `ACTIVE` plan (`404 PLAN_NOT_FOUND` if none), computes `dayNumber = floor((today - plan.startDate) / 1 day) + 1` in the service (UTC date-only arithmetic — no timezone handling this phase, matches `dateOfBirth`/`startDate` both being `@db.Date`), and joins to the matching `PlanTemplateDay`. If `dayNumber` is `< 1` or beyond the template's day count, returns `{ plan, day: null }` rather than an error — a plan with no day mapped for today is a valid, displayable state ("your plan starts tomorrow" / "you've completed this program"), not a failure. |
| 9 | New domain module `plans`, not folded into `children` or `media` | Same "one module per domain" reasoning as Phases 4–5. Depends on `children`'s `Child`/`ClinicianChildAssignment` tables directly via Prisma — no cross-module service import, consistent with "no repository layer." |

## 4. Data model (draft — confirm before migrating)

```prisma
enum PlanTemplateStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum PlanStatus {
  ACTIVE
  COMPLETED
  ARCHIVED
}

enum PlanOrigin {
  MANUAL
  AI
}

model PlanTemplate {
  id          String             @id @default(uuid()) @db.Uuid
  title       String
  description String?
  status      PlanTemplateStatus @default(DRAFT)
  createdById String             @db.Uuid
  createdBy   User               @relation("PlanTemplatesCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  days  PlanTemplateDay[]
  plans Plan[]

  @@map("plan_templates")
}

model PlanTemplateDay {
  id             String       @id @default(uuid()) @db.Uuid
  planTemplateId String       @db.Uuid
  planTemplate   PlanTemplate @relation(fields: [planTemplateId], references: [id], onDelete: Cascade)
  dayNumber      Int
  title          String
  instructions   String

  @@unique([planTemplateId, dayNumber])
  @@map("plan_template_days")
}

model Plan {
  id             String       @id @default(uuid()) @db.Uuid
  childId        String       @db.Uuid
  child          Child        @relation(fields: [childId], references: [id], onDelete: Cascade)
  planTemplateId String       @db.Uuid
  planTemplate   PlanTemplate @relation(fields: [planTemplateId], references: [id], onDelete: Restrict)
  status         PlanStatus   @default(ACTIVE)
  origin         PlanOrigin   @default(MANUAL)
  startDate      DateTime     @db.Date
  createdById    String       @db.Uuid
  createdBy      User         @relation("PlansCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  notes PlanNote[]

  @@index([childId])
  @@map("plans")
}

model PlanNote {
  id        String   @id @default(uuid()) @db.Uuid
  planId    String   @db.Uuid
  plan      Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)
  authorId  String   @db.Uuid
  author    User     @relation("PlanNotesAuthored", fields: [authorId], references: [id], onDelete: Restrict)
  note      String
  createdAt DateTime @default(now())

  @@index([planId])
  @@map("plan_notes")
}
```

`Child` gains `plans Plan[]`. `User` gains `planTemplatesCreated PlanTemplate[]`,
`plansCreated Plan[]`, `planNotesAuthored PlanNote[]`. `planTemplateId` on `Plan` uses
`onDelete: Restrict` (no template-deletion flow exists — a template with plans
referencing it must not disappear out from under them, same reasoning as every other
`Restrict` FK in this domain).

## 5. Endpoints (draft — confirm before coding)

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/plan-templates` | `planTemplateCreate` | `@Auth('plan-template:manage')` | Body `{ title, description?, days: [{ dayNumber, title, instructions }] }`, `dayNumber`s must be a contiguous `1..N` set (`400 VALIDATION_ERROR` otherwise — validated in the DTO/service, not the DB). `201` + `PlanTemplateDto` (includes `days[]`). |
| `GET` | `/v1/plan-templates` | `planTemplateList` | `@Auth('plan-template:read')` | `CLINICIAN` implicitly filtered to `status: PUBLISHED` (§3 row 6); `ADMIN` sees all. Cursor-paginated. |
| `GET` | `/v1/plan-templates/{id}` | `planTemplateGet` | `@Auth('plan-template:read')` | Includes `days[]`. `404 PLAN_TEMPLATE_NOT_FOUND` for a missing id **or** (for `CLINICIAN`) a non-published one. |
| `POST` | `/v1/plan-templates/{id}/publish` | `planTemplatePublish` | `@Auth('plan-template:manage')` | `DRAFT`/`ARCHIVED` → `PUBLISHED`. Idempotent if already `PUBLISHED`. |
| `POST` | `/v1/children/{childId}/plans` | `planAssign` | `@Auth('plan:manage')` | Body `{ planTemplateId, startDate }`. `404 CHILD_NOT_FOUND` / `404 PLAN_TEMPLATE_NOT_FOUND` / `409 PLAN_TEMPLATE_NOT_PUBLISHED` / `409 PLAN_ALREADY_ACTIVE`. `201` + `PlanDto`. |
| `POST` | `/v1/plans/{id}/complete` | `planComplete` | `@Auth('plan:manage')` | `ACTIVE`/`COMPLETED` → `COMPLETED`. `ARCHIVED` → `409 PLAN_ALREADY_FINAL`. |
| `POST` | `/v1/plans/{id}/archive` | `planArchive` | `@Auth('plan:manage')` | `ACTIVE`/`ARCHIVED` → `ARCHIVED`. `COMPLETED` → `409 PLAN_ALREADY_FINAL`. |
| `GET` | `/v1/children/{childId}/plans/today` | `planTodayFocus` | `@Auth('plan:read')` | Same ownership branch as `GET /v1/children/{id}`. `404 PLAN_NOT_FOUND` if the child has no `ACTIVE` plan. `200` + `{ plan: PlanDto, day: PlanTemplateDayDto \| null }`. |
| `POST` | `/v1/plans/{id}/notes` | `planNoteCreate` | `@Auth('plan-note:create')` | Body `{ note }`. Caller must be an assigned clinician (or admin) for the plan's child. `201` + `PlanNoteDto`. |
| `GET` | `/v1/plans/{id}/notes` | `planNoteList` | `@Auth('plan-note:read')` | Same assignment check as create. Cursor-paginated, `(createdAt asc, id asc)` — a thread reads oldest-first, unlike every other list in this codebase which sorts newest-first; call this out explicitly in the implementation so it isn't "fixed" to match the others by accident. |

Shared response DTOs in `src/modules/plans/shared/`: `PlanTemplateDto` (+ nested
`PlanTemplateDayDto`), `PlanDto`, `PlanNoteDto`.

## 6. Cross-cutting (draft)

- **Authz** — six new permissions per §2; two new *shapes* of service-side scoping
  beyond what Phases 4–5 established (§3 rows 6–7) — both get their own `rbac.md`
  decision-note entries, cross-referencing rather than duplicating the `child:read`
  writeup.
- **Pagination** — reuses `src/common/pagination/` as-is for all three list
  endpoints. Note the `plan-note:list` sort-order exception (§5).
- **OpenAPI** — nine new `EXPECTED` rows in `test/docs.e2e-spec.ts`.
- **Module wiring** — new `PlansModule`, registered in `app.module.ts`.
- **`truncateAll()`** — add `plan_notes`, `plans`, `plan_template_days`,
  `plan_templates` to the table list in `prisma.service.ts` (in that order — each FKs
  to the one after it, or to `children`/`users`).
- **Date arithmetic** — "today" for the day-offset computation is server UTC
  `Date`, truncated to midnight, compared against `plan.startDate` (also
  `@db.Date`). No per-child/per-user timezone support this phase — flag as a real
  product question if a parent in a very different timezone reports an
  off-by-one-day "Today's Focus," don't silently guess a fix here.

## 7. Build order (ordered checklist)

- [x] **0. Confirm §4/§5/§6 drafts** — re-read them against current
  `src/modules/media/` and `src/modules/children/` (the two closest precedents) and
  `docs/rbac.md` before writing any code; adjust this doc if reality has drifted
  since 2026-09-21. No drift found — drafts matched current conventions exactly.
- [x] **1. Schema + migration** — three enums, four models; `Child`/`User` relation
  fields; `truncateAll()` updated; `schema-decisions.md` entries (including the
  "intentionally no template versioning / no partial unique index" notes).
  Migration: `20260921165139_add_plan_domain`.
- [x] **2. Permissions** — all six from §2; two `rbac.md` decision notes (§3 rows
  6–7 above) — plus a third for `plan:manage`/`plan:read` and a fourth for
  `plan-note:read`'s withholding-from-`PARENT` shape.
- [x] **3. `PlanTemplate` CRUD + publish** — `PlansModule`,
  `shared/plan-template.dto.ts`, feature folders for create/list/get/publish;
  registered in `app.module.ts`; four `docs.e2e-spec.ts` rows.
- [x] **4. `Plan` assign + complete + archive** — `shared/plan.dto.ts`; feature
  folders; the `PLAN_ALREADY_ACTIVE` / `PLAN_TEMPLATE_NOT_PUBLISHED` /
  `PLAN_ALREADY_FINAL` invariants; three `docs.e2e-spec.ts` rows.
- [x] **5. "Today's Focus"** — feature folder; the day-offset computation (unit-test
  the pure date math separately from the Prisma calls, `day-offset.util.ts` +
  `.spec.ts`); one `docs.e2e-spec.ts` row.
- [x] **6. `PlanNote` create + list** — `shared/plan-note.dto.ts`; feature folders;
  the oldest-first sort; two `docs.e2e-spec.ts` rows.
- [x] **7. e2e suite** — `test/plan-domain.e2e-spec.ts` (22 tests): admin
  creates+publishes a template; assigning a `DRAFT` template is `409`; assigning
  while `ACTIVE` exists is `409`; assigned clinician can manage/annotate,
  non-assigned clinician cannot; parent reads "today's focus" but cannot read plan
  notes (`403`); a clinician not assigned to the plan's child cannot read/create
  notes; completing/archiving is idempotent and cross-terminal-transition is `409`;
  `GET /v1/plan-templates` as a clinician never returns a `DRAFT` row.
- [x] **8. Verify** — `npm run lint && npm test && npm run build && npm run test:e2e`
  green (136 unit tests, 107 e2e tests); this plan and the `docs/plans/README.md` row
  flipped to **Done**.

## 8. How to resume

> Nothing is implemented yet. Start at §7 step 0. The two closest precedents to mirror
> are `src/modules/children/features/get-child/get-child.service.ts` (existence-check
> ownership branching — reuse for `plan:manage`/`plan:read`) and
> `src/modules/media/features/list-media/list-media.service.ts` (cursor-paginated,
> ownership-scoped list — reuse for `plan-template:read`'s list, adapting the
> ownership branch to the query-filter shape described in §3 row 6 instead of an
> existence check). Work the checklist in order: schema → permissions → templates →
> plan assignment/lifecycle → today's-focus → notes, since later slices' tests assume
> earlier ones exist. Do not scaffold `MonthlyCallLog` here — that's Phase 7, and per
> the original roadmap it's a small, separate slice once this one is Done.

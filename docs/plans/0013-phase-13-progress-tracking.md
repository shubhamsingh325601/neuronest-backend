# Plan 0013 — Phase 13: Child Progress Tracking and Weekly Summary

Status: **Done** (scales/units remain provisional until D-7 — see §3 row 1)
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Implemented — see §9.**
> Revised 2026-10-04 after product input: progress is tracked **per child, independent of
> any plan**, with a computed weekly summary for parent, clinician and admin.

---

## 1. Context

Handoff §I — **MISSING FEATURE**: progress tracking for mood, behaviour and sleep, history
read, and a simple summary; today there is no model or API.

Product input (2026-10-04): a new parent signs up and adds a child; **no plan exists yet**
(a plan only appears after the parent discusses with a clinician, who sends a
template-based plan — see plan 0016). Progress tracking must therefore work **with no
plan, with an active plan, and between plans**. Tracking is **per child**, recorded per
day, rolled up **per week**, and "last week's summary" is shown to the parent, the
assigned clinicians and the admin.

This supersedes the earlier handoff wording "linked to active plan" as a hard requirement:
entries *optionally* record which plan was active, but never depend on one.

**Out of scope:** brain-growth graphs and clinical scoring (handoff exclusions), AI-written
summaries, notifications/reminders (deferred — Firebase/email later via the plan 0011
queue), clinician-authored free-text summary (see row 6).

## 2. Scope

**In:** `ProgressEntry` model; parent upsert-by-date; history list; computed weekly
summary endpoint; permissions; tests.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | **Scales (provisional, D-7 still open):** `mood` 1–5, `behaviour` 1–5, `sleepMinutes` 0–1440, optional `note` ≤ 1000 chars. All three scores are individually optional (at least one field per write). | Engineering default so work can proceed in staging. Ranges live in one constants file + DB `CHECK` constraints; changing them is a small migration. Confirm with product before production. |
| 2 | **Per child, plan-independent.** `ProgressEntry.childId` is required; `planId` is **nullable** and, when the child has an `ACTIVE` plan at first write, is set to it (kept on later updates). | Works for a brand-new child with no plan. |
| 3 | One entry per child per day: unique `(childId, entryDate)`; the write is an **idempotent upsert** `PUT /v1/children/{childId}/progress/{entryDate}`. | A retry cannot duplicate. |
| 4 | `entryDate` is date-only `YYYY-MM-DD`, not in the future (same UTC+14 tolerance as plan 0009 B-9) and not older than 30 days (constant). | Engineering default. |
| 5 | Writers: the child's PARENT only. Readers: PARENT own child, assigned CLINICIAN, ADMIN. | Same existence-check shape as `media:read`. |
| 6 | **Weekly summary is computed, not authored:** `GET /v1/children/{childId}/progress/weekly-summary?weekStart=YYYY-MM-DD` (default: the previous full week, Monday–Sunday UTC) returns per-week aggregates — days logged, average mood, average behaviour, average sleep minutes, min/max, the active plan id/title if any, and `trend` vs the prior week (`UP`/`DOWN`/`FLAT`/`null`). A free-text clinician summary (if wanted) is a later `ProgressNote` slice modelled on `PlanNote`. | Satisfies "last week summary for parent, clinician, admin" with no AI and no invented clinical scoring. Pure read; computed with one grouped query. |
| 7 | Weeks are ISO-style Monday–Sunday in UTC. | D-15: no timezone behaviour change anywhere yet. |
| 8 | The list is cursor-paginated by `entryDate desc`; `?from=&to=` optional. | Unbounded-over-time log → pagination, not the bounded-list exception. |
| 9 | A week with no entries returns zeros/nulls (`daysLogged: 0`), never a `404`. | A new parent can call it on day one. |

## 4. Data model

```prisma
model ProgressEntry {
  id           String   @id @default(uuid()) @db.Uuid
  childId      String   @db.Uuid
  child        Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  planId       String?  @db.Uuid
  plan         Plan?    @relation(fields: [planId], references: [id], onDelete: SetNull)
  entryDate    DateTime @db.Date
  mood         Int?
  behaviour    Int?
  sleepMinutes Int?
  note         String?
  createdById  String   @db.Uuid
  createdBy    User     @relation("ProgressEntriesCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([childId, entryDate])
  @@index([childId, entryDate(sort: Desc)])
  @@map("progress_entries")
}
```

- **Migration** `…_add_progress_entries` — additive; hand-written `CHECK` constraints for the ranges in §3 row 1 (verify with `migrate dev --create-only` that Prisma does not drop them).
- **`truncateAll()`**: add `'progress_entries'`.
- `docs/schema-decisions.md`: new section.

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `PUT` | `/v1/children/{childId}/progress/{entryDate}` | `progressUpsert` | `@Auth('progress:write:self')` | PARENT own child. Body `{ mood?, behaviour?, sleepMinutes?, note? }` (≥1 field). `201` created / `200` updated. |
| `GET` | `/v1/children/{childId}/progress` | `progressList` | `@Auth('progress:read')` | PARENT own, assigned CLINICIAN, ADMIN. `?from&to&cursor&limit`. |
| `GET` | `/v1/children/{childId}/progress/weekly-summary` | `progressWeeklySummary` | `@Auth('progress:read')` | Same scoping. `?weekStart=`. Always `200`. |

## 6. Cross-cutting

- **Permissions (new)** — `progress:write:self` (PARENT), `progress:read` (PARENT, CLINICIAN, ADMIN). `rbac.md` note (clinician read-only).
- **Validation** — strict DTO; shared date validator from plan 0009 (`src/common/validation/`).
- **Errors** — `CHILD_NOT_FOUND`, `FORBIDDEN`; no new codes.
- **Notifications** — deferred (no reminders now).
- **OpenAPI/tests** — 3 new `EXPECTED` rows; `rbac-route-coverage` unchanged logic.

## 7. Build order (ordered checklist — complete)

- [x] **1.0** Re-read §3 rows 1 and 4 (provisional ranges/window); adjust if product has answered D-7.
- [x] **1.1** Migration + model + `CHECK`s + `truncateAll()`.
- [x] **1.2** Permissions + `rbac.md`.
- [x] **1.3** `progress/` module: `upsert-progress`, `list-progress`, `weekly-summary` slices; DTOs; unit specs (ranges, plan association, aggregates, trend, empty week).
- [x] **1.4** e2e `test/progress.e2e-spec.ts`: new child with **no plan** can log; upsert same date → one row; `planId` set when a plan is active and kept after the plan completes; history order/pagination; weekly summary maths and empty week; clinician assigned reads / unassigned 403 / cannot write; other parent 403; admin reads; future/too-old date 400; out-of-range value 400.
- [x] **1.5** `docs.e2e-spec.ts` rows; verify `npm run lint && npm test && npm run build && npm run test:e2e`.
- [x] **2.1** Docs pass; Status → **Done**; update `docs/plans/README.md`; summary.

## Testing

Unit: upsert, scoping, aggregates/trend. E2E as above. `docs.e2e` rows: `progressUpsert`, `progressList`, `progressWeeklySummary`.

## Risks and open questions

- Scales are provisional until D-7; the `CHECK` constraints make a later change a deliberate migration.
- "Activity tracking" in the sense of *plan-day completion* (did the child do today's activity?) is **not** in this plan; it can be a later `PlanDayCompletion` slice once plan 0016 gives plans their own days.
- Open question: confirm the provisional scales and the 30-day back-dating window with product before production.

## 8. How to resume

> Implemented — see §9. Precedents: `list-media.service.ts`
> (ownership shape), `create-plan-note.service.ts` (actor stamp).
>
> Paste-ready prompt: *"Implement docs/plans/0013 from step 1.0. Progress is per child and
> must work with no plan. The weekly summary is computed (no AI, no free text)."*

---

## 9. Implementation summary

Implemented 2026-10-04 in two batches (build → docs/close). Final: 415 unit tests / 81
suites, 289 e2e tests / 22 suites (+ new `test/progress.e2e-spec.ts`), lint and build clean.

**Plan deviations / decisions made while building**
- **Date validator.** Plan 0009's `IsDateOnlyNotFuture` (`src/common/validation/`) is reused
  for `entryDate`, `from`, `to` and `weekStart`. The 30-day back-dating limit is checked in
  the upsert service (`400 VALIDATION_ERROR`); a path-param DTO validates the date.
- **PUT = replace.** Omitted fields are stored as null; an empty body is
  `400 VALIDATION_ERROR` (no new error codes). `201` created / `200` replaced via a
  passthrough `@Res`; a unique-violation race on create falls back to an update.
- **`planId`** is stamped from the ACTIVE plan on first write only and never changed.
- **`weekStart`** may be any date; it is normalised to that week's Monday and the response
  echoes the Monday. Default is the previous full Monday–Sunday UTC week.
- **`trend`** compares the combined mood+behaviour average to the prior week (±0.25 → FLAT;
  sleep excluded; null if either week lacks mood/behaviour data).
- **One query, not a grouped query.** The summary fetches the requested + prior week
  (≤14 rows) with one `findMany` and aggregates in code (needed for min/max/trend anyway).
- **`activePlan.title`** comes from the plan's template (`Plan` has no title column).
- **ADMIN** holds `progress:write:self` via the spread but the service rejects non-parent
  writers; documented in `docs/rbac.md`.
- Migration `20261004190000_add_progress_entries` is hand-assembled from `migrate diff`
  output plus the `CHECK`s (the configured dev DB is a pooled Neon URL, so `migrate dev` was
  not used); `migrate diff` reports no drift.

**Files**
- Schema + migration: `ProgressEntry`; `truncateAll()` updated.
- Permissions: `progress:write:self`, `progress:read`.
- `src/modules/progress/` — `upsert-progress`, `list-progress`, `weekly-summary` (+ specs;
  shared access check, date util, week summariser, constants).
- Tests: `test/progress.e2e-spec.ts`, 3 new `docs.e2e` rows.
- Docs: `rbac.md`, `schema-decisions.md`, `testing.md`.

**Not built (per plan):** AI summaries, notifications/reminders, clinician free-text summary
(`ProgressNote`), plan-day completion tracking, brain-growth graphs/clinical scoring.
**Still open:** confirm the provisional scales and 30-day window with product (D-7) before production.

# Plan 0007 — Phase 7: Monthly Call Log

Status: **Active**
Owner: backend
Last updated: 2026-09-22

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet** —
> this doc was authored ahead of the coding session per this repo's convention (plan
> doc before code), mirroring exactly how [0005](0005-phase-5-media-upload.md) and
> [0006](0006-phase-6-plan-domain.md) were authored ahead of their sessions.

---

## 1. Context

Phases 4–6 (all Done) shipped the rest of the Core Care Domain: `Child` +
`ClinicianChildAssignment`, `Media` upload, and the `Plan` domain
(`PlanTemplate`/`Plan`/`PlanNote`). This is the fifth and — per the original Milestone
A roadmap — **last** planned phase of the Core Care Domain build-out: logging a
clinician's monthly check-in call with a child's parent. It is deliberately the
smallest phase in the series; the original architecture note calls it out as "small,"
and there is exactly one new table.

**Out of scope — must not be scaffolded here:** anything from the Core Care Domain's
own out-of-scope list, unchanged since Phase 4 — no AI-pipeline persistence, no
waitlist/CMS tables, no goal-tracking/scoring/reporting, no document-type registry
beyond `Media`, no admin/parent/clinician frontend. Nothing past this phase is
currently roadmapped for Milestone A; once this phase is Done, the Core Care Domain
build-out described in the original Milestone A scoping round is **complete** — the
next work after this is either genuinely new product scope (not yet decided) or the
AI pipeline (a separate, not-yet-started track).

## 2. Scope

**In:**

- Schema: `MonthlyCallLog` model — `childId`, `clinicianId`, `calledAt`, optional
  `notes`. One migration.
- Permissions: `monthly-call:create` (CLINICIAN-assigned/ADMIN), `monthly-call:read`
  (CLINICIAN-assigned/ADMIN — **not** `PARENT`, see §3 row 3 — same
  clinician-coordination framing as Phase 6's `PlanNote`).
- Endpoints (see §5): log a call, list a child's call history.
- Tests alongside every slice; e2e coverage for the same
  assigned/non-assigned/cross-parent isolation shape as every prior Core Care Domain
  phase, plus confirming a `PARENT` gets `403` on both endpoints.
- Doc updates: `schema-decisions.md`, `rbac.md`, `docs/plans/README.md`.

**Out:** editing or deleting a logged call (append-only, matches `PlanNote`'s
"working paper" framing — same reasoning, don't relitigate it here). No reminder/
scheduling system for *when* the next monthly call is due (a real feature, but not
this phase — this phase only records that a call happened). No validation that
`calledAt` isn't in the future — a deliberate simplification; flag it if clinicians
are observed mis-logging dates rather than adding a rule unprompted.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | `calledAt` is a full `DateTime`, not `@db.Date` | Unlike `Child.dateOfBirth` / `Plan.startDate` (calendar dates with no meaningful time-of-day), a phone call happens at a specific moment — worth keeping the time component. |
| 2 | `monthly-call:create`/`:read` scoping for `CLINICIAN` requires a live `ClinicianChildAssignment` for the log's child | Identical existence-check shape to `plan:manage` (`docs/rbac.md` §6) — checked in the service via `MonthlyCallLog.childId` → the assignment table. `ADMIN` unconditional. |
| 3 | `MonthlyCallLog` is **not** readable by `PARENT` | Matches the original architecture note's own endpoint list — "clinician log-call endpoint, admin/clinician read views" — which never mentions a parent view, and the resolved ownership table's `PARENT` row (own `Child`/`Media`, read own `Plan`) never lists `MonthlyCallLog` either. This is the same shape of non-obvious scoping as Phase 6's `PlanNote`-withheld-from-`PARENT` decision — flagged here for the same reason: it withholds something from a role that already has deep access to the same child's other records, so it needs to be an explicit, documented choice, not an oversight. |
| 4 | New domain module `call-logs`, not folded into `children` | Same "one module per domain" reasoning as every prior phase, even though this phase is small — consistency with the established pattern outweighs the minor overhead of a new module folder. |
| 5 | No single-log-by-id `GET` | Same reasoning as Phase 5/6's narrow read surfaces — the only MVP screen is a child's call history list; add a by-id read if a screen actually needs one later. |

## 4. Data model (draft — confirm before migrating)

```prisma
model MonthlyCallLog {
  id          String   @id @default(uuid()) @db.Uuid
  childId     String   @db.Uuid
  child       Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  clinicianId String   @db.Uuid
  clinician   User     @relation("MonthlyCallLogsLogged", fields: [clinicianId], references: [id], onDelete: Restrict)
  calledAt    DateTime
  notes       String?
  createdAt   DateTime @default(now())

  @@index([childId])
  @@map("monthly_call_logs")
}
```

`Child` gains `monthlyCallLogs MonthlyCallLog[]`. `User` gains
`monthlyCallLogsLogged MonthlyCallLog[]`. `clinicianId` uses `onDelete: Restrict` —
same audit-trail reasoning as every other "who did this" FK in this domain
(`Media.uploadedById`, `Plan.createdById`, `PlanNote.authorId`).

## 5. Endpoints (draft — confirm before coding)

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/children/{childId}/call-logs` | `monthlyCallLogCreate` | `@Auth('monthly-call:create')` | Body `{ calledAt, notes? }`. Caller must be an assigned clinician (or admin) for the child. `404 CHILD_NOT_FOUND`; `403 FORBIDDEN` if not assigned. `201` + `MonthlyCallLogDto`. |
| `GET` | `/v1/children/{childId}/call-logs` | `monthlyCallLogList` | `@Auth('monthly-call:read')` | Same assignment check as create. Cursor-paginated, `(calledAt desc, id desc)` — matches every other list endpoint's newest-first convention (unlike Phase 6's `PlanNote` list, which is oldest-first for its own stated reason). |

Shared response DTO: `MonthlyCallLogDto` (`id, childId, clinicianId, calledAt, notes,
createdAt`) in `src/modules/call-logs/shared/`.

## 6. Cross-cutting (draft)

- **Authz** — two new permissions; one `rbac.md` decision note (§3 row 3), written to
  cross-reference the `PlanNote`-withheld-from-`PARENT` note rather than duplicate its
  reasoning.
- **Pagination** — reuses `src/common/pagination/` as-is.
- **OpenAPI** — two new `EXPECTED` rows in `test/docs.e2e-spec.ts`.
- **Module wiring** — new `CallLogsModule`, registered in `app.module.ts`.
- **`truncateAll()`** — add `monthly_call_logs` to the table list in
  `prisma.service.ts`.

## 7. Build order (ordered checklist — nothing started yet)

- [ ] **0. Confirm §4/§5/§6 drafts** — re-read them against current
  `src/modules/plans/` (the closest precedent — same assignment-existence-check
  shape, same "withheld from PARENT" scoping) and `docs/rbac.md` before writing any
  code; adjust this doc if reality has drifted since 2026-09-22.
- [ ] **1. Schema + migration** — `MonthlyCallLog` model; `Child`/`User` relation
  fields; `truncateAll()` updated; `schema-decisions.md` entry.
- [ ] **2. Permissions** — `monthly-call:create`, `monthly-call:read`; `rbac.md`
  decision note (§3 row 3 above).
- [ ] **3. `POST /v1/children/{childId}/call-logs`** — `CallLogsModule`,
  `shared/monthly-call-log.dto.ts`, feature folder (dto, controller, service, spec);
  registered in `app.module.ts`; `docs.e2e-spec.ts` row.
- [ ] **4. `GET /v1/children/{childId}/call-logs`** — feature folder, cursor
  pagination; `docs.e2e-spec.ts` row.
- [ ] **5. e2e suite** — `test/monthly-call-log.e2e-spec.ts`: assigned clinician logs
  a call and lists it; a non-assigned clinician gets `403` on both; a parent gets
  `403` on both (even for their own child); admin can do both unconditionally for any
  child; unknown `childId` is `404`.
- [ ] **6. Verify** — `npm run lint && npm test && npm run build && npm run test:e2e`
  green; flip this plan and the `docs/plans/README.md` row to **Done**.

## 8. How to resume

> Nothing is implemented yet. Start at §7 step 0. The closest precedent to mirror is
> `src/modules/plans/` — specifically whatever service enforces `plan:manage`'s
> assignment check (existence-check shape, same as `child:read`) and the `rbac.md`
> decision note explaining why `PlanNote` is withheld from `PARENT` (mirror that
> note's structure for `MonthlyCallLog`, don't re-derive the reasoning from scratch).
> This is the smallest Core Care Domain phase — one table, two endpoints — so the
> whole checklist should be a short session. Once §7 is fully checked and this plan
> flips to Done, **the Core Care Domain build-out from the original Milestone A
> scoping round is complete.** Do not start any further phase without a fresh
> scoping conversation — nothing past this point has been decided yet (the AI
> pipeline and any post-MVP product scope are explicitly out of scope for
> unprompted continuation).

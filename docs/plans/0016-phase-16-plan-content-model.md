# Plan 0016 — Phase 16: Plan Content Model (Template → Per-Child Plan)

Status: **Done** (e2e 246 passing, 2026-10-04)
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet.**
> Raised by product on 2026-10-04: admin creates and edits templates, a clinician creates
> a child's plan from a template and can adjust it, and a future AI generator must produce
> the **same** kind of plan. All three must be consistent.

---

## 1. Context

Product flow (stated 2026-10-04): a parent signs up and adds a child → **no plan exists**
→ the parent discusses with a clinician → the clinician sends a plan based on a template →
the clinician may tailor it for that child → later, AI-generated plans must follow the same
shape. Admin owns templates.

Today's model (`prisma/schema.prisma`): `PlanTemplate` → `PlanTemplateDay`; a `Plan`
**references** its template (`planTemplateId`, `onDelete: Restrict`) and reads days live
from it. Consequences found in the audit:

- A clinician **cannot** customise one child's plan (days are shared with the template).
- If an admin ever edits a template's days, every assigned plan changes silently. (No
  edit-days endpoint exists today, but the design invites it.)
- An AI plan has nowhere to put child-specific days (`PlanOrigin.AI` exists but nothing
  can populate it), which is why the handoff §F says the structure "does not persist
  child-specific generated content".

**Should this use an EAV (entity-attribute-value) pattern?** Recommendation: **no.**
EAV stores every field as a generic `(entity, attribute, value)` row. It gives schema
flexibility but loses typing, `NOT NULL`/`CHECK`/foreign-key enforcement, and makes even
simple reads ("all of week 2") multi-join pivots; Prisma has no good support for it. The
flexibility actually needed here — templates with named sections whose count/titles vary —
is solved by ordinary **relational rows** (a section table), and truly free-form payload
is solved by Postgres **JSONB**. Both stay typed, constrained, queryable and Prisma-native.

**Out of scope:** AI generation itself, review workflow for AI plans (handoff §F), parent
visibility rules for AI plans (D-13), a drag-and-drop template editor UI, EAV.

## 2. Scope

**In:** copy-on-assign plan content (`PlanDay` rows owned by the plan); optional template
sections; clinician edit of their child's plan days; admin edit of **draft** template
content; one content shape shared by template, manual plan and future AI plan.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | **No EAV.** Relational rows for structure, JSONB only for genuinely free-form extras. | Reasoning in §1. |
| 2 | **Snapshot on assign:** `AssignPlanService` copies the template's days (and sections) into `plan_days` / `plan_sections` owned by the new `Plan`. The plan keeps `planTemplateId` for provenance only. | Editing a template later never alters assigned plans; the clinician can tailor one child's plan; AI writes the same rows. |
| 3 | **One content shape for everything:** `Section { id, title, position }` → `Day { dayNumber, sectionId?, title, instructions }`. Template, plan and (future) AI output all use it. | The AI generator's output contract is "a list of sections and days"; it gets validated by the same DTO a clinician uses. |
| 4 | `PlanDetailDto` (plan 0009) keeps its contract (`title`, `description`, `days[]`), plus an additive `sections[]`; only its **source** changes (plan-owned rows instead of the template). | Parent app is unaffected. |
| 5 | Admin edits template content only while the template is `DRAFT` (published templates are immutable; to change one, clone to a new draft). `POST /v1/plan-templates/{id}/clone` creates a draft copy. | Keeps published templates trustworthy as snapshots' provenance. |
| 6 | Clinician (assigned) or admin edits a plan's days while the plan is `ACTIVE`: `PUT /v1/plans/{id}/days/{dayNumber}` (upsert one day), `DELETE …/days/{dayNumber}`, and section CRUD via `PUT /v1/plans/{id}/sections`. Parent is read-only. | `plan:manage` reused (no new permission); edits are stamped (`updatedAt`, `updatedById`). |
| 7 | A `Plan` may later have `origin = AI` and an optional `reviewedAt/reviewedById`; **not added now** (AI is out of scope). | The snapshot model means no further schema change is needed for the content itself. |
| 8 | Existing assigned plans are **backfilled**: a one-off migration copies each plan's template days into `plan_days`. | Staging only, but the migration must be re-runnable-safe. |
| 9 | Coaching tips (plan 0012) and plan-day completion (future) attach to the plan, not the template. | Consistent with the snapshot. |
| 11 | **Day range (Q1, answered 2026-10-04: undecided → backend default chosen):** a clinician may upsert **any** `dayNumber` `1..365` on a plan, including beyond the template's last day. Plan days are plan-owned rows (`@@unique([planId, dayNumber])`), so gaps and extension are cheap; template-range-only would be a pure validation rule that can be added later without schema change. Template content itself still requires contiguous `1..N`. | Revisit if product wants a hard cap at the template range. |
| 12 | **Edit flagging (Q2):** no flag/notification. Edits only stamp `updatedAt` / `updatedById` on the day. | Additive `lastEditedAt` in the DTO is a later option. |
| 13 | **Push template fixes to assigned plans (Q3):** **No**, until product confirms. Fix = clone template, publish, assign anew. | No re-sync endpoint this phase. |
| 14 | **Seed templates from a JSON file:** `prisma/seed-data/plan-templates.json` holds starter templates (title, description, status, optional sections, days). `npm run db:seed` upserts them idempotently (matched by title) so product can see what a template looks like. | The JSON is gitignored (local seed data). |
| 10 | Template `description`/extras that are truly free-form may live in a `meta Json?` column on `Plan` and `PlanTemplate`; nothing queryable goes in JSON. | Escape hatch instead of EAV. |

## 4. Data model

```prisma
model PlanTemplateSection {
  id             String       @id @default(uuid()) @db.Uuid
  planTemplateId String       @db.Uuid
  planTemplate   PlanTemplate @relation(fields: [planTemplateId], references: [id], onDelete: Cascade)
  title          String
  position       Int
  days           PlanTemplateDay[]
  @@unique([planTemplateId, position])
  @@map("plan_template_sections")
}
// PlanTemplateDay gains: sectionId String? @db.Uuid (FK, SetNull)

model PlanSection {
  id       String @id @default(uuid()) @db.Uuid
  planId   String @db.Uuid
  plan     Plan   @relation(fields: [planId], references: [id], onDelete: Cascade)
  title    String
  position Int
  days     PlanDay[]
  @@unique([planId, position])
  @@map("plan_sections")
}

model PlanDay {
  id           String       @id @default(uuid()) @db.Uuid
  planId       String       @db.Uuid
  plan         Plan         @relation(fields: [planId], references: [id], onDelete: Cascade)
  sectionId    String?      @db.Uuid
  section      PlanSection? @relation(fields: [sectionId], references: [id], onDelete: SetNull)
  dayNumber    Int
  title        String
  instructions String
  updatedById  String?      @db.Uuid
  updatedAt    DateTime     @updatedAt
  @@unique([planId, dayNumber])
  @@map("plan_days")
}
```

- **Migration A** `…_add_plan_content_tables` — new tables + `plan_template_days.section_id`; additive.
- **Migration B** `…_backfill_plan_days` — `INSERT INTO plan_days … SELECT … FROM plans JOIN plan_template_days …`; idempotent (`ON CONFLICT DO NOTHING`).
- **`truncateAll()`**: add `'plan_days'`, `'plan_sections'`, `'plan_template_sections'` (before `plans`/`plan_templates`).
- `docs/schema-decisions.md`: snapshot rationale and the "why not EAV" note.

## 5. Endpoints (proposed)

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/plan-templates/{id}/clone` | `planTemplateClone` | `plan-template:manage` | Admin. New `DRAFT` copy incl. sections/days. |
| `PUT` | `/v1/plan-templates/{id}/content` | `planTemplateContentReplace` | `plan-template:manage` | Admin, `DRAFT` only (`409 PLAN_TEMPLATE_NOT_DRAFT`). Replaces sections+days atomically. |
| `PUT` | `/v1/plans/{id}/days/{dayNumber}` | `planDayUpsert` | `plan:manage` | Assigned CLINICIAN / ADMIN; plan must be `ACTIVE`. |
| `DELETE` | `/v1/plans/{id}/days/{dayNumber}` | `planDayDelete` | `plan:manage` | Idempotent `204`. |
| `PUT` | `/v1/plans/{id}/sections` | `planSectionsReplace` | `plan:manage` | Replace section list (titles/positions). |
| `GET` | `/v1/plans/{id}` | `planGet` | `plan:read` | Unchanged route; additive `sections[]`; days now read from `plan_days`. |

## 6. Cross-cutting

- No new permissions (`plan-template:manage`, `plan:manage`, `plan:read` reused).
- `AssignPlanService` copies content inside its existing transaction; the `P2002` handling from plan 0009 remains.
- `TodayFocusService` and `GetPlanService` switch to `plan_days`.
- `docs.e2e-spec.ts`: 5 new rows; `rbac-route-coverage` must pass.

## 7. Build order (ordered checklist — nothing started yet)

- [x] **0.0** Walk the flow with product (§8 questions) and revise this plan. Done 2026-10-04 (rows 11–14).
- [x] **0.1** Seed JSON of starter templates + seed.ts upsert (row 14).
- [x] **1.1** Migration A + models + `truncateAll()`.
- [x] **1.2** `AssignPlanService` snapshot copy; `Today`/`GetPlan` read from `plan_days`; Migration B backfill.
- [x] **1.3** (written in `test/plan-content.e2e-spec.ts`, run, passing) e2e: assign copies days; editing/cloning a template never changes an assigned plan; `plans/today` and `GET /plans/{id}` unchanged for existing data.
- [x] **1.4** Verify full suite: unit (331) and e2e (246) green.
- [x] **2.1** Template draft edit + clone; e2e (published immutable → 409).
- [x] **2.2** Clinician plan-day/section edit; e2e (assigned vs unassigned vs parent 403, edit only while ACTIVE).
- [x] **3.1** Docs pass; Status → **Done**; README.

## Testing

Unit: snapshot copy, immutability rules, scoping. E2E as above. `docs.e2e` rows for all new routes.

## Risks and open questions

- Snapshot duplicates content per plan (cheap at this scale).
- Backfill correctness for existing plans (verify counts before/after).
- Open questions for the product walk-through: answered — see §3 rows 11–13.

## 8. How to resume

> Step 0.0 is done; continue from the first unchecked item in §7.
>
> Paste-ready prompt: *"Read docs/plans/0016. Walk me through the §7 step 0.0 questions,
> update the plan with my answers, then implement from Batch 1. No EAV."*

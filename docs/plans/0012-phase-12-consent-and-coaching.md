# Plan 0012 — Phase 12: Media Consent Record and Manual Weekly Coaching

Status: **Proposed**
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet.**
> Independent of plans 0010/0011; can be built any time after 0009.

---

## 1. Context

Two small, parent-facing content stores from the V1 handoff:

- **§C Consent / media privacy record — MISSING FEATURE.** There is no consent model,
  media deletion or retention field. The handoff asks only for a *foundation*: persist
  consent with a version id, grant time and withdrawal time; parent-owned read, grant
  and withdraw. Consent wording, retention period, withdrawal effect, deletion policy and
  upload gating are **D-2 decisions and are not built here**.
- **§H Weekly coaching, manual part — MISSING FEATURE.** Persist weekly tips tied to a
  child and plan week; parent reads own child's current week; admin authors manually.
  The AI-generation half is **out of scope** (AI).

**Out of scope:** AI-generated tips, WhatsApp/email delivery (D-11), upload gating on
consent, media deletion/retention, consent wording catalogue, anything AI.

## 2. Scope

**In:** `MediaConsent` model + 3 routes; `CoachingTip` model + 2 routes; permissions;
tests; docs.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Consent is **append-only history**: one `MediaConsent` row per grant; the "current" consent is the row with `withdrawnAt IS NULL AND supersededAt IS NULL`. A partial unique index enforces **at most one open row per child**. | Hand-written partial index in the migration (same technique as plan 0009 B-6). |
| 2 | `consentVersion` is an **opaque string** (`^[A-Za-z0-9._-]{1,64}$`); the server keeps no catalogue and no wording. | D-2: wording lives in the frontend. Consequence: a parent can "consent" to a version the server has never heard of — accepted, noted in Risks. |
| 3 | Grant semantics: same version while open → idempotent `200` (existing row); different version while open → the old row gets `supersededAt = now` and a new row is created (`201`). Never silently overwrite. | Version bumps are not "withdrawals". |
| 4 | Withdraw: sets `withdrawnAt` on the open row; no open row → idempotent `200` with the current (none) state — not an error. | **No** deletion, no upload gating, no retention effect (D-2). |
| 5 | Consent scoping = parent of the child (`child:read`-shaped existence check) or admin. Clinicians do **not** read consent in this phase. | Open Q: should assigned clinicians see it? |
| 6 | Coaching is stored **per child + plan + week**: `CoachingTip(childId, planId, weekNumber, position, title, body, authorId)`, unique `(planId, weekNumber, position)`. | Matches the handoff ("associated with child and relevant plan week"). Open Q: author per **template** instead? |
| 7 | Authoring (admin or the plan's assigned clinician) is `PUT /v1/plans/{id}/coaching/{weekNumber}` — a **full, idempotent replacement** of that week's tip set (≤ 5 tips). Rerunning never duplicates; an empty `tips` array clears the week. | Legitimate use of `PUT` (reserved in `api-conventions.md` for full replacement). Replacement runs in one transaction (delete + insert). |
| 8 | `weekNumber` is derived from `dayNumber`: `ceil(dayNumber / 7)`, using the same UTC `computeDayNumber` as Today's Focus. `GET …/coaching?week=current` resolves against the child's `ACTIVE` plan; `week=N` reads a specific week of the active plan. Outside the plan range → empty list, not an error. | D-5/D-15: no week entities, UTC unchanged. |
| 9 | Parent coaching response contains title/body/weekNumber/position only — no `authorId`. | Same audience-redaction approach as plan 0009. |
| 10 | Delivery is in-app only. | D-11 not needed. |

## 4. Data model

```prisma
model MediaConsent {
  id            String    @id @default(uuid()) @db.Uuid
  childId       String    @db.Uuid
  child         Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  grantedById   String    @db.Uuid
  grantedBy     User      @relation("MediaConsentsGranted", fields: [grantedById], references: [id], onDelete: Restrict)
  consentVersion String
  grantedAt     DateTime  @default(now())
  withdrawnAt   DateTime?
  supersededAt  DateTime?
  createdAt     DateTime  @default(now())

  @@index([childId, grantedAt])
  @@map("media_consents")
}

model CoachingTip {
  id         String   @id @default(uuid()) @db.Uuid
  childId    String   @db.Uuid
  child      Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  planId     String   @db.Uuid
  plan       Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)
  weekNumber Int
  position   Int
  title      String
  body       String
  authorId   String   @db.Uuid
  author     User     @relation("CoachingTipsAuthored", fields: [authorId], references: [id], onDelete: Restrict)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([planId, weekNumber, position])
  @@index([childId, weekNumber])
  @@map("coaching_tips")
}
```

Hand-written in the migration: `CREATE UNIQUE INDEX media_consents_one_open_per_child ON media_consents (child_id) WHERE withdrawn_at IS NULL AND superseded_at IS NULL;` — verify `migrate dev --create-only` shows no drift.

- **Migration** `…_add_media_consent_and_coaching` — additive, safe on existing data.
- **`truncateAll()`**: add `'coaching_tips'` and `'media_consents'` (before `plans`/`children`; both cascade anyway).
- `docs/schema-decisions.md`: sections for both models (append-only consent rationale; per-plan coaching).

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `GET` | `/v1/children/{childId}/consent` | `consentGet` | `@Auth('consent:read')` | PARENT own child, ADMIN. `{ status: 'GRANTED' \| 'WITHDRAWN' \| 'NONE', current, history[] }` (history capped at 50, newest first). `404 CHILD_NOT_FOUND`. |
| `POST` | `/v1/children/{childId}/consent` | `consentGrant` | `@Auth('consent:manage:self')` | PARENT own child. Body `{ consentVersion }`. `201` new / `200` idempotent. |
| `POST` | `/v1/children/{childId}/consent/withdraw` | `consentWithdraw` | `@Auth('consent:manage:self')` | Action-path exception (state transition). `200`, idempotent. |
| `PUT` | `/v1/plans/{id}/coaching/{weekNumber}` | `coachingReplace` | `@Auth('coaching:manage')` | ADMIN or assigned CLINICIAN. Body `{ tips: [{ title, body }] }` (≤5). `404 PLAN_NOT_FOUND`. Idempotent. |
| `GET` | `/v1/children/{childId}/coaching` | `coachingList` | `@Auth('coaching:read')` | `?week=current\|<n>`. PARENT own child, assigned CLINICIAN, ADMIN. Ordered by `position`. |

## 6. Cross-cutting

- **Permissions (new)** — `consent:read` (PARENT, ADMIN), `consent:manage:self` (PARENT), `coaching:manage` (CLINICIAN assigned, ADMIN), `coaching:read` (PARENT, CLINICIAN, ADMIN). Ownership/assignment scoping is service-level (same shapes as `child:read`); add `rbac.md` §6 notes (clinician excluded from consent; coaching author redaction).
- **Validation** — strict DTOs; `consentVersion` regex; `tips` array size/length limits (title ≤ 120, body ≤ 2000).
- **Errors** — reuse `CHILD_NOT_FOUND`, `PLAN_NOT_FOUND`, `FORBIDDEN`; no new codes needed.
- **OpenAPI/tests** — 5 new `EXPECTED` rows; `rbac-route-coverage` must pass.
- **Concurrency** — double grant races are settled by the partial unique index (`P2002` → re-read and return idempotent `200`).

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Consent

- [ ] **1.0** Re-confirm with product that wording/retention/gating stay out (D-2); confirm clinician read (Open Q).
- [ ] **1.1** Migration (both tables + partial index), `truncateAll()`, `prisma generate`.
- [ ] **1.2** Permissions + `rbac.md` notes.
- [ ] **1.3** `children`-adjacent module `consents/` (or `children/features/…`): get, grant, withdraw slices + DTOs + unit specs.
- [ ] **1.4** e2e `test/consent.e2e-spec.ts`: grant persists version + time; same version idempotent; new version supersedes; withdraw records time and is idempotent; parent reads only own; other parent 403; clinician 403; admin reads; concurrent grants → one open row.
- [ ] **1.5** `docs.e2e-spec.ts` rows; verify `npm run lint && npm test && npm run build && npm run test:e2e`.

### Batch 2 — Weekly coaching

- [ ] **2.0** Confirm per-plan vs per-template authoring (Open Q) **before** building.
- [ ] **2.1** Permissions + notes; `coaching` slices (`replace`, `list`), week-resolution helper reusing `computeDayNumber`.
- [ ] **2.2** e2e `test/coaching.e2e-spec.ts`: admin replace is idempotent (twice → same rows); manual tip appears in the right week; current-week resolution; out-of-range → empty; parent isolation; clinician assigned reads / unassigned 403; non-admin 403 on PUT; `authorId` absent for parent.
- [ ] **2.3** `docs.e2e-spec.ts` rows; verify full suite.

### Batch 3 — Close

- [ ] **3.1** Docs pass; Status → **Done**; update `docs/plans/README.md`; implementation summary.

## Testing

Unit specs per slice (mocked Prisma); e2e as above; `docs.e2e` EXPECTED rows: `consentGet`, `consentGrant`, `consentWithdraw`, `coachingReplace`, `coachingList`; `rbac-route-coverage` unchanged logic.

## Risks and open questions

- Opaque consent version can reference nonexistent wording (no server catalogue).
- Per-plan coaching means admins author per child; a per-template store may be what's wanted.
- Plan archived/completed → what week does a parent see? (Current design: active plan only.)
- **Resolved 2026-10-04:** coaching is authored **per plan** (confirmed). Because the end-to-end flow (new parent → discussion with a clinician → clinician sends a template-based plan) is still being shaped, authoring is allowed for **admin and the plan's assigned clinician** (`coaching:manage`) — cheap now, easy to narrow later. Clinicians do **not** read consent (least privilege; add later if a screen needs it). Coaching on a completed/archived plan is hidden from the parent's `week=current` view (only the active plan resolves) but stays readable by clinician/admin by plan id.
- A new parent has **no plan**, so coaching returns an empty list for them, not an error.
- See plan 0016 for the plan content model that coaching tips attach to.

## 8. How to resume

> Nothing implemented yet. Start at Batch 1, step 1.0. Precedents: `list-media.service.ts`
> (ownership shape), `create-plan-template.service.ts` (admin authoring).
>
> Paste-ready prompt: *"Implement docs/plans/0012 from Batch 1. Do not invent consent
> wording, retention or upload gating. Ask me the Batch 2.0 question before building coaching."*

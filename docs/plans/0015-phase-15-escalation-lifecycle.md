# Plan 0015 — Phase 15: Escalation Lifecycle (Manual Raise)

Status: **Proposed — owner/notification BLOCKED on D-3 and D-16**
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet.**

---

## 1. Context

Handoff §K — **MISSING FEATURE**: a crisis/escalation record with a status lifecycle and a
24-hour deadline that clinicians/admins act on, a parent status read, and admin visibility
of open/overdue items. The handoff's *trigger* (§E/§L) is an AI analysis result — **AI is
out of scope** here, so this plan builds the lifecycle plus a **manual raise** path
(assigned clinician or admin) and an idempotency seam so a future automated trigger can
plug in without a redesign.

**Blocked/decision items (not invented):** D-3 (named owner/process, assignment target,
notification target, breach alerting) and D-16 (what counts as high distress). Therefore:
**no assignee column, no notifications, no breach alerting, no detection rule.**

**Out of scope:** AI trigger, detection thresholds, notification delivery, assignment to a
named owner, on-call rotation, SLA breach alerts, parent-initiated escalation.

## 2. Scope

**In:** `Escalation` model; raise / list-for-child / list-all / acknowledge / resolve;
permissions; admin-summary counts; tests.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Statuses: `OPEN → ACKNOWLEDGED → RESOLVED`. Resolve is allowed from `OPEN` or `ACKNOWLEDGED`. No reopen. | Each transition stamps a timestamp + actor id. |
| 2 | `dueAt = createdAt + 24h`, **stored** at creation (not recomputed). | Matches the signed-scope 24-hour requirement. |
| 3 | **Overdue is computed**, not stored: `status != RESOLVED AND dueAt < now()`. | No cron needed to flip a flag. |
| 4 | Acknowledge and resolve are **idempotent**: repeating returns `200` with the current state. Acknowledging a `RESOLVED` escalation is a no-op `200`; resolving twice is a no-op `200`. | Per `api-conventions.md` action semantics. |
| 5 | Manual raise: assigned CLINICIAN or ADMIN → `POST /v1/children/{childId}/escalations` `{ reason }`. PARENT cannot raise. | Open Q: who may raise without AI? (recommendation above). |
| 6 | **Idempotency seam:** nullable unique `dedupeKey`. `EscalationService.raise(tx, { childId, reason, raisedById \| null, dedupeKey? })` is an internal method a later automation/job calls; a duplicate `dedupeKey` returns the existing row. | Gives the handoff's "retries must not duplicate" property now without any AI code. |
| 7 | **Parent view is status-only:** `{ id, status, createdAt, acknowledgedAt, resolvedAt }` — **no** `reason`, `resolutionNote` or actor ids. Clinician/admin get the full record. | Audience-aware serialisation (same approach as plan 0009). |
| 8 | Scoping: child's PARENT (read, redacted), assigned CLINICIAN (read/ack/resolve/raise), ADMIN (everything). Unassigned clinician → `403`. | Same existence-check shape as `plan:manage`. |
| 9 | `GET /v1/escalations` — ADMIN sees all; CLINICIAN is **query-filtered** to assigned children. Filters `?status=`, `?overdue=true`, cursor pagination by `(dueAt asc, id asc)`. | Overdue/open queryable by admin per handoff. |
| 10 | Admin summary gains additive `openEscalations` and `overdueEscalations`. | |
| 11 | No assignee/owner column until D-3 is answered; adding one later is a nullable-column migration. | |
| 12 | No notification emails now. A breach/notification job would be a plan 0011 job type once D-3 names the target. | |

## 4. Data model

```prisma
enum EscalationStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

model Escalation {
  id               String           @id @default(uuid()) @db.Uuid
  childId          String           @db.Uuid
  child            Child            @relation(fields: [childId], references: [id], onDelete: Cascade)
  raisedById       String?          @db.Uuid
  raisedBy         User?            @relation("EscalationsRaised", fields: [raisedById], references: [id], onDelete: SetNull)
  reason           String
  status           EscalationStatus @default(OPEN)
  dueAt            DateTime
  acknowledgedAt   DateTime?
  acknowledgedById String?          @db.Uuid
  acknowledgedBy   User?            @relation("EscalationsAcknowledged", fields: [acknowledgedById], references: [id], onDelete: SetNull)
  resolvedAt       DateTime?
  resolvedById     String?          @db.Uuid
  resolvedBy       User?            @relation("EscalationsResolved", fields: [resolvedById], references: [id], onDelete: SetNull)
  resolutionNote   String?
  dedupeKey        String?          @unique
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  @@index([childId, createdAt(sort: Desc)])
  @@index([status, dueAt])
  @@map("escalations")
}
```

- **Migration** `…_add_escalations` — enum + table; additive.
- **`truncateAll()`**: add `'escalations'` (before `children`/`users`; it cascades anyway).
- `docs/schema-decisions.md`: new section (stored `dueAt`, computed overdue, no assignee until D-3).

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/children/{childId}/escalations` | `escalationCreate` | `@Auth('escalation:create')` | Assigned CLINICIAN / ADMIN. Body `{ reason }`. `201` + full record. `404 CHILD_NOT_FOUND`. |
| `GET` | `/v1/children/{childId}/escalations` | `escalationListForChild` | `@Auth('escalation:read')` | PARENT own child (**redacted** view), assigned CLINICIAN, ADMIN. Cursor-paginated. |
| `GET` | `/v1/escalations` | `escalationList` | `@Auth('escalation:read')` | ADMIN all, CLINICIAN assigned children only; `?status=&overdue=&cursor&limit`. PARENT → `403` (they use the per-child route). |
| `POST` | `/v1/escalations/{id}/acknowledge` | `escalationAcknowledge` | `@Auth('escalation:manage')` | Assigned CLINICIAN / ADMIN. `200`, idempotent. `404 ESCALATION_NOT_FOUND`. |
| `POST` | `/v1/escalations/{id}/resolve` | `escalationResolve` | `@Auth('escalation:manage')` | Body `{ resolutionNote? }`. `200`, idempotent. |

`GET /v1/admin/summary` gains `openEscalations`, `overdueEscalations`.

## 6. Cross-cutting

- **Permissions (new)** — `escalation:create` (CLINICIAN, ADMIN), `escalation:read` (PARENT, CLINICIAN, ADMIN), `escalation:manage` (CLINICIAN, ADMIN). A route handler can grant a permission to PARENT yet the **service** refuses `GET /v1/escalations` for PARENT — document in `rbac.md` (read-withheld-by-shape, like `plan-note:read`).
- **Errors (new)** — `ESCALATION_NOT_FOUND`; reuse `CHILD_NOT_FOUND`, `FORBIDDEN`.
- **OpenAPI/tests** — 5 new `EXPECTED` rows; `rbac-route-coverage` unchanged logic.
- **Privacy** — `reason` can contain sensitive text; never logged (Pino redaction not needed if the service never logs the body; add a lint-level review note).
- **Future automation** — the `dedupeKey` seam + plan 0011 queue are the extension points; nothing AI-specific is built.

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Lifecycle

- [ ] **1.0** Confirm Open Qs (who may raise; D-3 owner stays unbuilt).
- [ ] **1.1** Migration + enum + model + `truncateAll()`.
- [ ] **1.2** Permissions + `rbac.md` notes.
- [ ] **1.3** Slices: `raise-escalation`, `list-child-escalations`, `list-escalations`, `acknowledge-escalation`, `resolve-escalation`; audience-aware DTOs; unit specs (transitions, idempotency, `dedupeKey`, redaction, `dueAt`).
- [ ] **1.4** e2e `test/escalation.e2e-spec.ts`: raise sets `dueAt = createdAt + 24h`; acknowledge/resolve stamp time+actor and are idempotent; parent sees status-only fields (no `reason`); other parent 403; unassigned clinician 403 on every route; assigned clinician acts; admin sees open/overdue (back-date `dueAt` to create an overdue row); `?overdue=true` filter; duplicate `dedupeKey` creates one row; clinician list limited to assigned children.
- [ ] **1.5** Admin summary counts + `docs.e2e-spec.ts` rows; verify `npm run lint && npm test && npm run build && npm run test:e2e`.

### Batch 2 — Close

- [ ] **2.1** Docs pass; Status → **Done** (with D-3/D-16 items still listed as blocked); update `docs/plans/README.md`; summary.

## Testing

Unit: transitions, redaction, idempotency, dedupe. E2E as above. `docs.e2e` rows: `escalationCreate`, `escalationListForChild`, `escalationList`, `escalationAcknowledge`, `escalationResolve`.

## Risks and open questions

- Without an owner (D-3) an `OPEN` escalation can sit unnoticed; `overdue` queryability and the admin summary are the only safety net until alerting is built.
- Manual raise is a stop-gap; the real trigger is AI-driven and out of scope here.
- **Resolved 2026-10-04 (engineering call):** only the assigned clinician or an admin may raise an escalation (a parent-initiated path would need its own abuse and triage design); `resolutionNote` is optional (forcing text slows urgent closes); D-3/D-16 remain product-owned and unbuilt. Notifications (Firebase push / email to parents or clinicians) are deferred to a later phase via the plan 0011 queue.

## 8. How to resume

> Nothing implemented yet. Start at Batch 1, step 1.0. Precedents: `log-call.service.ts`
> (assigned-clinician/admin check), `create-plan-note` (append + actor stamp).
>
> Paste-ready prompt: *"Implement docs/plans/0015 from Batch 1. No assignee column,
> notifications or detection rule (D-3/D-16 are open). Parent view must omit reason and
> notes."*

# Plan 0014 — Phase 14: Monthly Call Appointments

Status: **Proposed**
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet.**

---

## 1. Context

Handoff §J — **MISSING FEATURE**. Today only clinician-written, retrospective
`MonthlyCallLog` rows exist (plan 0007); a parent cannot see upcoming calls. Required: a
clinician/admin publishes availability; a parent books a free slot with a clinician
assigned to the child's care; the parent reads upcoming/past appointments with the clinician's
name; clinicians see their booked calls; **concurrent requests must never double-book**.

**D-9 (open):** the join mechanism (provider/link/phone) — appointment scheduling ships **without** join
data. Cancellation/rescheduling are not in the signed V1 scope and are **not added**.

**Out of scope:** join links, video provider integration, cancellation, rescheduling,
reminders/notification emails (can use the plan 0011 queue later), AI, chat.

## 2. Scope

**In:** `AppointmentSlot` + `Appointment`; five routes; permissions; concurrency proof; tests.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Two tables: `AppointmentSlot` (published availability) and `Appointment` (**`slotId` UNIQUE**). | The unique constraint is the **database-enforced** double-booking guard; `P2002` → `409 SLOT_ALREADY_BOOKED`. |
| 2 | Concurrency is proven by an e2e `Promise.all` of two appointments on one slot: exactly one `201`, one `409`. | No explicit locking needed. |
| 3 | Slot overlap per clinician: `@@unique([clinicianId, startsAt])` plus a service-level overlap check. No GiST exclusion constraint / `btree_gist` extension. | Only clinicians/admins publish (low concurrency); an extension is not worth it. Residual race noted in Risks. |
| 4 | Slot rules: `startsAt` in the future, `endsAt > startsAt`, duration ≤ 2 h (constant), clinician must be `ACTIVE` (admin publishing for a clinician) — `409 CLINICIAN_NOT_ACTIVE` otherwise. | Duration cap is an engineering guard, not a product rule; adjustable. |
| 5 | A parent can only book a slot belonging to a clinician **assigned to their child**. A slot of an unassigned clinician returns `404 SLOT_NOT_FOUND` (does not disclose existence). Booking an appointment requires the slot to be free and in the future. | Same assignment join as every clinician check. |
| 6 | Parent's free-slot listing (`GET /children/{id}/appointment-slots`) is a **query filter**: slots where `clinicianId IN (child's assigned clinicians)`, future, unbooked. | Same "query-filter scoping" shape as `GET /v1/children` and `plan-template:read` (rbac.md). |
| 7 | Appointment response and parent appointments list embed `clinician: { id, name }` only — no email, no profile. | Handoff: "parent reads … clinician name". |
| 8 | No join fields now. A later migration adds nullable join columns once D-9 is decided. | |
| 9 | `MonthlyCallLog` (retrospective) is untouched. A nullable `appointmentId` link is a possible later addition, not now. | |
| 10 | No cap on appointments per child in this plan. | Open Q: one upcoming appointment per child? "Monthly" is not enforced by the handoff. Enforcement, if wanted, is a service check inside the booking transaction. |
| 11 | A deactivated/suspended clinician's future appointments are **left untouched** (no auto-cancel — cancellation is out of scope); admin handles manually. | Open Q. |

## 4. Data model

```prisma
model AppointmentSlot {
  id          String   @id @default(uuid()) @db.Uuid
  clinicianId String   @db.Uuid
  clinician   User     @relation("AppointmentSlotsOwned", fields: [clinicianId], references: [id], onDelete: Restrict)
  startsAt    DateTime
  endsAt      DateTime
  createdById String   @db.Uuid
  createdBy   User     @relation("AppointmentSlotsCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime @default(now())

  appointment Appointment?

  @@unique([clinicianId, startsAt])
  @@index([clinicianId, startsAt])
  @@map("appointment_slots")
}

model Appointment {
  id         String   @id @default(uuid()) @db.Uuid
  slotId     String   @unique @db.Uuid
  slot       AppointmentSlot @relation(fields: [slotId], references: [id], onDelete: Restrict)
  childId    String   @db.Uuid
  child      Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  bookedById String   @db.Uuid
  bookedBy   User     @relation("AppointmentsMade", fields: [bookedById], references: [id], onDelete: Restrict)
  createdAt  DateTime @default(now())

  @@index([childId])
  @@map("appointments")
}
```

- **Migration** `…_add_appointment_slots_and_appointments` — additive.
- **`truncateAll()`**: add `'appointments'` then `'appointment_slots'` (before `children`/`users`).
- `docs/schema-decisions.md`: new sections (unique-slot guard rationale).

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/appointment-slots` | `appointmentSlotCreate` | `@Auth('appointment-slot:manage')` | CLINICIAN (own) / ADMIN (`clinicianId` required for admin). Body `{ clinicianId?, startsAt, endsAt }`. `201`. `409 SLOT_OVERLAP`, `409 CLINICIAN_NOT_ACTIVE`. |
| `GET` | `/v1/children/{childId}/appointment-slots` | `appointmentSlotList` | `@Auth('appointment-slot:read')` | PARENT own child, assigned CLINICIAN, ADMIN. Free future slots of the child's assigned clinicians; cursor-paginated by `startsAt`. |
| `POST` | `/v1/children/{childId}/appointments` | `appointmentCreate` | `@Auth('appointment:create:self')` | PARENT own child. Body `{ slotId }`. `201`. `404 SLOT_NOT_FOUND`, `409 SLOT_ALREADY_BOOKED`. |
| `GET` | `/v1/children/{childId}/appointments` | `appointmentListForChild` | `@Auth('appointment:read')` | PARENT own, assigned CLINICIAN, ADMIN. `?when=upcoming\|past`. |
| `GET` | `/v1/appointments` | `appointmentList` | `@Auth('appointment:read')` | CLINICIAN → own appointments (query filter by `slot.clinicianId`); ADMIN → all. `?when=&cursor`. |

## 6. Cross-cutting

- **Permissions (new)** — `appointment-slot:manage` (CLINICIAN, ADMIN), `appointment-slot:read` (PARENT, CLINICIAN, ADMIN), `appointment:create:self` (PARENT), `appointment:read` (PARENT, CLINICIAN, ADMIN). Service-level scoping; `rbac.md` notes (unassigned clinician slot → 404; clinician sees only own appointments).
- **Time** — all instants stored/returned as UTC ISO-8601 `timestamptz`; no timezone logic (D-15 stays parked).
- **Errors (new)** — `SLOT_NOT_FOUND`, `SLOT_ALREADY_BOOKED`, `SLOT_OVERLAP`, `CLINICIAN_NOT_ACTIVE` (shared with plan 0010).
- **Notifications** — none now; a appointment-confirmation email would be a plan 0011 job (`email.appointment-confirmation`), added only if requested.
- **OpenAPI/tests** — 5 new `EXPECTED` rows; `rbac-route-coverage` unchanged logic.

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Availability

- [ ] **1.0** Confirm Open Qs (booking cap; deactivated-clinician appointments).
- [ ] **1.1** Migration + models + `truncateAll()`.
- [ ] **1.2** Permissions + `rbac.md`.
- [ ] **1.3** `call-slots` slices: `create-slot`, `list-slots` + DTOs + unit specs (overlap, duration, past, clinician status).
- [ ] **1.4** e2e `test/appointment.e2e-spec.ts` part 1: clinician publishes own slot; admin publishes for a clinician; clinician cannot publish for another; overlap 409; past 400; parent lists only assigned clinicians' free slots; unassigned/unrelated parent sees none.
- [ ] **1.5** Verify `npm run lint && npm test && npm run build && npm run test:e2e`.

### Batch 2 — Appointments

- [ ] **2.1** `create-appointment`, `list-child-appointments`, `list-appointments` slices + DTOs (embed clinician name).
- [ ] **2.2** e2e part 2: parent books assigned clinician's slot; booked slot disappears from the free list; **concurrent `Promise.all` booking → one 201, one 409**; unassigned clinician slot → 404; other parent cannot book/read; parent sees booking + clinician name; clinician sees booked call; other clinician sees nothing; admin sees all; past/upcoming filter.
- [ ] **2.3** `docs.e2e-spec.ts` rows; verify full suite.

### Batch 3 — Close

- [ ] **3.1** Docs pass; Status → **Done**; update `docs/plans/README.md`; summary (note D-9 join data still pending).

## Testing

Unit: slot rules, booking guard, scoping. E2E as above. `docs.e2e` rows: `appointmentSlotCreate`, `appointmentSlotList`, `appointmentCreate`, `appointmentListForChild`, `appointmentList`.

## Risks and open questions

- Two publishers racing the same clinician could create overlapping (non-identical-start) slots — acceptable at this write volume; revisit with an exclusion constraint if it happens.
- No cancellation: a mistaken booking cannot be undone via API.
- Slot duration cap (2 h) is an engineering default.
- Open questions: (1) cap — one upcoming appointment per child? (2) future appointments when a clinician is deactivated; (3) slot length conventions; (4) appointment confirmation email wanted (via 0011)?

## 8. How to resume

> Nothing implemented yet. Start at Batch 1, step 1.0. Precedents: `log-call.service.ts`
> (assignment check), `list-children.service.ts` (query-filter scoping).
>
> Paste-ready prompt: *"Implement docs/plans/0014 from Batch 1. The unique slotId is the
> double-booking guard; prove it with a concurrent e2e test. Do not add join data,
> cancellation or rescheduling."*

## Naming and deferred notifications (decided 2026-10-04)

- **Naming:** the entity is an **Appointment** (a scheduled call with a clinician); "booking" is only the verb (a parent *books* a free `AppointmentSlot`). Routes, permissions and operationIds use `appointment*`; the error code `SLOT_ALREADY_BOOKED` stays because it describes the slot.
- **Notifications are deferred to a later phase** (parent push via Firebase Cloud Messaging and/or email). The queue from plan 0011 is the intended carrier (`push.appointment-reminder`, `email.appointment-confirmation`); nothing is built here.
- **Product answers recorded:** appointment cap and deactivated-clinician handling are decided by engineering below.
  - Cap: **one upcoming appointment per child** (service check inside the creating transaction; `409 APPOINTMENT_ALREADY_UPCOMING`). Reason: the signed scope says *monthly* call with a human coach; allowing unlimited bookings lets one family hoard slots.
  - Deactivated clinician: future appointments stay visible and admin must reassign manually; no auto-cancel (cancellation is out of scope).

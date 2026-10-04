# Plan 0010 — Phase 10: Clinician Lifecycle (Admin-Created)

Status: **Proposed**
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet.**
> Depends on nothing in 0009 except the single-use token fix (X-4); it can ship before
> 0011 because the invitation sender is designed as a seam (§3 row 3).

---

## 1. Context

Product decision (already made, not relitigated): there is **no public clinician
application flow**. Clinician interest is lead data in an Excel sheet on the frontend.
The admin creates clinicians directly, they get an emailed link, and finish setup.

Today clinicians only enter via `POST /v1/clinician-applications/{id}/approve`
(`src/modules/clinicians/features/approve-application/approve-application.service.ts`),
which needs a prior public application row. The docx's "Preserve" list still names
"clinician applications and account lifecycle" — **MISMATCH** with the decision above.

What already exists and is reused:

- `VerificationTokenService.issueAccountSetupToken` already consumes earlier outstanding
  tokens (`verification-token.service.ts:139-152`) — resend invalidation is free.
- `POST /v1/auth/complete-account-setup` already finishes the flow.
- `POST /v1/users/{id}/suspend` / `/reactivate` already implement activate/deactivate.
- A separate TTL setting already exists (`ACCOUNT_SETUP_TTL_MIN`, default 60).

Audit findings fixed here:

| # | Finding | Evidence |
|---|---|---|
| X-1 | `complete-account-setup` never checks the user is `INVITED`, and suspending does not revoke setup tokens → a suspended/deactivated invitee can re-activate themselves with an old link. | `src/modules/auth/features/complete-account-setup/complete-account-setup.service.ts:36-44`, `suspend-user.service.ts:48-54` |
| X-2 | Reactivating a user suspended while `INVITED` sets `ACTIVE` with a null password and unverified email — the account can never log in. | `src/modules/users/features/reactivate-user/reactivate-user.service.ts:36-40` |
| X-6 | `assign-clinician` ignores clinician status. | `src/modules/children/features/assign-clinician/assign-clinician.service.ts:22-31` |
| X-9 | `.env.example` pins `ACCOUNT_SETUP_TTL_MIN=60`; a changed default would not reach deployed envs. | `.env.example`, `configuration.ts:82` |
| X-10 | Public unauthenticated `POST /v1/clinician-applications` is an unrequested PII write sink with no consumer. | `submit-application.controller.ts` |
| X-11 | Setup email says "your application has been approved" and counts minutes. | `src/common/email/templates/account-setup.template.ts:6,9` |

**Out of scope:** the job queue (plan 0011 — here the invite is best-effort inline),
clinician self-service profile editing, email change after activation, clinician-facing
dashboards, AI, chat.

## 2. Scope

**In:** admin create / list / get / update / resend-invitation for clinicians; new
`ClinicianProfile`; lifecycle bug fixes X-1/X-2/X-6; invitation TTL 72h; removal of the
clinician-application slice; admin-summary field change.

**Out:** see above.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Clinicians are created by admin: `POST /v1/clinicians` `{ name, email, profile? }` → `User` (`CLINICIAN`, `INVITED`, `passwordHash: null`, `emailVerifiedAt: null`) + `ClinicianProfile`, in **one transaction**. `201` + `ClinicianDetailDto`. | Email normalised lowercase; existing email → `409 EMAIL_ALREADY_REGISTERED` (admin-only route, disclosure is fine). |
| 2 | Email failure **never** rolls back creation. | Invitation is sent *after* commit. |
| 3 | The invitation sender is `InvitationService.issueAndSend(userId)` in `src/modules/clinicians/shared/`: mint ACCOUNT_SETUP token → build `{APP_WEB_URL}/complete-account-setup?token=…` (plain URL, not shortened) → `EmailService.sendAccountSetupLink`. In **this** phase it is called inline after commit inside try/catch (failure logged + Sentry, request still succeeds). In plan 0011 the same method becomes the job handler — **HTTP contract does not change**. | Token minted at send time so a payload never has to carry a secret (see 0011). |
| 4 | Resend: `POST /v1/clinicians/{id}/resend-invitation` → `202`, no body. Valid only while `INVITED` (`409 CLINICIAN_NOT_INVITED` otherwise). No new user; earlier tokens die because `issueAccountSetupToken` consumes outstanding ones. | `404 CLINICIAN_NOT_FOUND` if the id is not a `CLINICIAN`. |
| 5 | Update: `PATCH /v1/clinicians/{id}` — `name`, profile fields, `email`. Email changes only while `INVITED` (`409 CLINICIAN_EMAIL_LOCKED` after activation); a change consumes outstanding tokens and re-invites the **new** address. | Post-activation email change needs a verification flow — out of scope. |
| 6 | Activate/deactivate **reuses** `POST /v1/users/{id}/suspend` and `/reactivate` (`user:manage-status`). No new routes. | Frontend labels: "Deactivate" = suspend, "Activate" = reactivate. |
| 7 | X-1 fix: `suspend` and self-`deactivate` consume outstanding `ACCOUNT_SETUP` tokens; `complete-account-setup` additionally requires `status === INVITED` (else the same opaque `400 INVALID_SETUP_TOKEN`). | |
| 8 | X-2 fix: `reactivate` on a user with `passwordHash === null` restores `INVITED` (not `ACTIVE`); the admin then resends the invitation. Response `{ id, status, updatedAt }` shows `INVITED`. | |
| 9 | Invitation TTL: new env `ACCOUNT_SETUP_TTL_HOURS`, default **72**, replacing `ACCOUNT_SETUP_TTL_MIN`. Password-reset TTL stays 60 min. | New name on purpose: a stale `ACCOUNT_SETUP_TTL_MIN=60` in a deployed env is simply ignored (Joi allows unknown env keys). |
| 10 | `ClinicianProfile` 1:1 (`userId` unique, cascade). Proposed optional fields: `phone`, `specialisation`, `qualifications`, `licenseNumber`, `bio`. Legacy clinicians (created via the old approve flow) have no row → DTO returns nulls; `PATCH` upserts. | Final field list is an open question for the frontend. Admin-only visibility; parents never see profile data. |
| 11 | `ClinicianDetailDto` adds `invitationSentAt` and `invitationExpiresAt` **derived** from the latest `ACCOUNT_SETUP` `VerificationToken` (`createdAt`/`expiresAt`), plus `activatedAt` (= `emailVerifiedAt`), `lastLoginAt`, `assignedChildIds`. No new `User` column. | |
| 12 | `GET /v1/clinicians` gains `?status=` and `?q=` (case-insensitive substring over name/email). Existing cursor pagination unchanged; `ClinicianDto` gains invitation fields. | |
| 13 | **Application slice: REMOVE, do not keep dormant.** Delete the five routes (`clinicianApplicationSubmit/List/Get/Approve/Reject`), their services/DTOs/specs, their wiring in `clinicians.module.ts`, and the permissions `clinician-application:list` / `clinician-application:review`. Drop the `clinician_applications` table and the `ClinicianApplicationStatus` enum **in the same phase** (staging only — no data to preserve, confirmed 2026-10-04). | Reasons: public unauthenticated PII sink, no consumer, a second clinician-creation path that would drift (its own inline email, its own TTL). Git history keeps the code. Frontend confirmed nothing calls these routes. |
| 14 | Admin summary: remove `pendingClinicianApplications`, add `invitedClinicians`. | **Contract break** — flag to the frontend developer before release. |
| 15 | X-6: `AssignClinicianService` requires clinician status `INVITED` or `ACTIVE`; `SUSPENDED`/`DEACTIVATED` → `409 CLINICIAN_NOT_ACTIVE`. | Recommendation — confirm (Open Q). INVITED allowed so an admin can pre-assign; the clinician cannot authenticate until active anyway. |
| 16 | The email template becomes invitation copy ("An administrator has invited you…"), shows the TTL in **hours**. A shared `buildWebLink(path, token)` helper in `src/common/email/` replaces the three hand-built URLs. | |

## 4. Data model

```prisma
model ClinicianProfile {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @unique @db.Uuid
  user           User     @relation("ClinicianProfileUser", fields: [userId], references: [id], onDelete: Cascade)
  phone          String?
  specialisation String?
  qualifications String?
  licenseNumber  String?
  bio            String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("clinician_profiles")
}
```

`User` gains the back-relation `clinicianProfile ClinicianProfile? @relation("ClinicianProfileUser")`.

- **Migration 1** `…_add_clinician_profile` — new table only; additive, safe on existing data.
- **Migration 2** `…_drop_clinician_applications` — drops `clinician_applications` and the `ClinicianApplicationStatus` enum. The environment is staging, so no export or release gap is needed (decided 2026-10-04). If this ever reaches a production DB with rows, export first.
- `truncateAll()` (`src/common/prisma/prisma.service.ts`): add `'clinician_profiles'` in migration 1's commit; remove `'clinician_applications'` in migration 2's commit (same phase).
- `docs/schema-decisions.md`: add a `ClinicianProfile` section; mark `ClinicianApplication` as removed.

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/clinicians` | `clinicianCreate` | `@Auth('clinician:manage')` | Admin only. Body `{ name, email, profile? }`. `201` + `ClinicianDetailDto`. `409 EMAIL_ALREADY_REGISTERED`. |
| `GET` | `/v1/clinicians` | `clinicianList` | `@Auth('clinician:list')` | Existing; adds `status`, `q`, invitation fields. |
| `GET` | `/v1/clinicians/{id}` | `clinicianGet` | `@Auth('clinician:list')` | `ClinicianDetailDto`. `404 CLINICIAN_NOT_FOUND`. |
| `PATCH` | `/v1/clinicians/{id}` | `clinicianUpdate` | `@Auth('clinician:manage')` | `name`, profile fields, `email` (INVITED only). `409 CLINICIAN_EMAIL_LOCKED`, `409 EMAIL_ALREADY_REGISTERED`. Idempotent in practice. |
| `POST` | `/v1/clinicians/{id}/resend-invitation` | `clinicianResendInvitation` | `@Auth('clinician:manage')` | `202`, no body. `409 CLINICIAN_NOT_INVITED`. |
| `POST` | `/v1/users/{id}/suspend`, `/reactivate` | `userSuspend`, `userReactivate` | `user:manage-status` | Existing; X-1/X-2 fixes (§3 rows 7–8). |
| `POST` | `/v1/children/{id}/clinicians` | `childAssignClinician` | `clinician-child:manage` | Existing; X-6 status check. |
| `GET` | `/v1/admin/summary` | `adminSummaryGet` | `admin-summary:read` | `pendingClinicianApplications` removed, `invitedClinicians` added. |
| `POST` | `/v1/clinician-applications` | ~~`clinicianApplicationSubmit`~~ | — | **Removed.** |
| `GET` | `/v1/clinician-applications`, `/{id}` | ~~`clinicianApplicationList/Get`~~ | — | **Removed.** |
| `POST` | `/v1/clinician-applications/{id}/approve`, `/reject` | ~~`clinicianApplicationApprove/Reject`~~ | — | **Removed.** |

Shared DTOs: `ClinicianDetailDto`, `ClinicianProfileDto`, `CreateClinicianDto`, `UpdateClinicianDto` in `src/modules/clinicians/shared/`; `ClinicianDto` extended.

## 6. Cross-cutting

- **Permissions** — new `clinician:manage` (ADMIN only). Removed: `clinician-application:list`, `clinician-application:review`. `clinician:list` unchanged and now also covers the detail route. `docs/rbac.md`: add a `clinician:manage` decision note; replace the application-permission notes with a "removed in Phase 10" line; add the lifecycle rules (suspend/reactivate/INVITED).
- **Config** — add `ACCOUNT_SETUP_TTL_HOURS`, remove `ACCOUNT_SETUP_TTL_MIN` from `configuration.ts`, `env.validation.ts`, `.env.example`, `ResendEmailService`, `VerificationTokenService`.
- **Errors** — new: `CLINICIAN_NOT_FOUND`, `CLINICIAN_NOT_INVITED`, `CLINICIAN_EMAIL_LOCKED`, `CLINICIAN_NOT_ACTIVE`. All RFC 9457 via `AllExceptionsFilter`.
- **Account enumeration** — admin-only routes may disclose email clashes; the public `complete-account-setup` keeps its single opaque `INVALID_SETUP_TOKEN`.
- **Tokens** — hashed at rest as today; no raw token is stored or logged (the invitation URL is only passed to the email provider; ensure the Resend failure path does not log the URL — it currently logs `err` and `to` only).
- **Module wiring** — `ClinicianApplications*` providers/controllers removed from `clinicians.module.ts`; `AuthModule` import stays (tokens).
- **OpenAPI** — `docs.e2e-spec.ts` `EXPECTED`: remove 5 application rows; add `clinicianCreate`, `clinicianGet`, `clinicianUpdate`, `clinicianResendInvitation` (the `clinicianList` row stays).
- **`rbac-route-coverage`** — every new handler has `@Auth('…')`; nothing here is `@Public()`.

## 7. Build order (ordered checklist — nothing started yet)

### Batch A — Lifecycle bug fixes (no new routes)

- [ ] **A.0** Failing tests first: suspended invitee completes setup with an old token (X-1); suspend INVITED → reactivate → ACTIVE with null password (X-2).
- [ ] **A.1** `SuspendUserService` + `DeactivateService` consume ACCOUNT_SETUP tokens (add a `VerificationTokenService.revokeAccountSetup(userId)` helper).
- [ ] **A.2** `CompleteAccountSetupService` status guard (`INVITED` only).
- [ ] **A.3** `ReactivateUserService` restores `INVITED` for null-password users.
- [ ] **A.4** `AssignClinicianService` status check (X-6) — only after the Open Q is answered.
- [ ] **A.5** Update `test/user-status.e2e-spec.ts`, `test/clinician-application.e2e-spec.ts` (setup flow assertions move to the new clinician spec in Batch B), unit specs.
- [ ] **A.6** Verify: `npm run lint && npm test && npm run build && npm run test:e2e`.

### Batch B — Clinician CRUD + invitation

- [ ] **B.1** Migration 1 (`ClinicianProfile`), `truncateAll()` update, `prisma generate`.
- [ ] **B.2** Config: `ACCOUNT_SETUP_TTL_HOURS`; update template (hours + invitation copy); `buildWebLink` helper.
- [ ] **B.3** `clinician:manage` permission + `rbac.md` note.
- [ ] **B.4** `InvitationService.issueAndSend`; `create-clinician`, `get-clinician`, `update-clinician`, `resend-invitation` feature folders; extend `list-clinicians` (filters + fields); DTOs.
- [ ] **B.5** e2e: new `test/clinician-lifecycle.e2e-spec.ts` — create → mail captured → complete setup → login; duplicate email 409; resend (old token 400, new token 200, **no second user**); resend on ACTIVE → 409; email PATCH while INVITED re-invites, after ACTIVE 409; email provider throws → clinician still created (use a failing `FakeEmailService` mode); suspend/reactivate flows; non-admin 403 on every route.
- [ ] **B.6** `docs.e2e-spec.ts` rows; verify full suite.

### Batch C — Remove the application slice

- [ ] **C.1** Delete the five routes/services/DTOs/specs, `clinician-application:*` permissions, update `clinicians.module.ts`, `test/clinician-application.e2e-spec.ts` (delete), `docs.e2e-spec.ts` (remove rows).
- [ ] **C.2** Admin summary: remove `pendingClinicianApplications`, add `invitedClinicians`; update unit + e2e.
- [ ] **C.3** Docs: `rbac.md`, `testing.md` (suite table), `auth-flows.md` (clinician onboarding), `architecture.md` if it names the flow, `schema-decisions.md`.
- [ ] **C.4** Verify full suite. Confirm removed routes return `404`.
- [ ] **C.5** Migration 2 (drop table + enum), remove `clinician_applications` from `truncateAll()` and `ClinicianApplication` from `schema.prisma`; run `prisma generate`; verify full suite.

### Batch D — Close

- [ ] **D.1** Flip Status to **Done**, update `docs/plans/README.md`, write the implementation summary (files, env change, migrations, contract breaks to flag to the frontend).

## Testing

- **Unit:** `create-clinician`, `update-clinician`, `resend-invitation`, `invitation.service`, `suspend`, `reactivate`, `complete-account-setup`, `deactivate`, `assign-clinician`, `get-summary`.
- **E2E:** `clinician-lifecycle` (new), `user-status`, `admin-summary`, `child-care-domain` (assign status check), `docs`, `rbac-route-coverage`.
- **`docs.e2e` EXPECTED:** as in §6.

## Risks and open questions

- **Admin summary break** (`pendingClinicianApplications` removed) — coordinate with the frontend.
- **Pre-0011 email failure** — an invite that fails to send leaves an `INVITED` clinician with no email; admin must notice and resend (log + Sentry only). 0011 removes this gap with retries and a DEAD list.
- **Expired link** — after 72h the link yields `INVALID_SETUP_TOKEN`; admin resends. No self-service re-request (would be an enumeration surface).
- **Resolved 2026-10-04:** profile fields stay as proposed (the clinician profile is not the current focus; extend later); table is dropped now (staging); the X-6 restriction to `INVITED`/`ACTIVE` is adopted (assigning a suspended/deactivated clinician would silently give a child a care-team member who cannot act); `pendingClinicianApplications` is removed from the summary (nothing consumes it).
- No open questions remain for this phase.

## 8. How to resume

> Nothing is implemented yet. Start at Batch A, step A.0. Closest precedents:
> `approve-application.service.ts` (provision + invite — being replaced),
> `suspend-user.service.ts` / `reactivate-user.service.ts` (status shape),
> `list-clinicians.service.ts` (admin directory), `reset-password.service.ts` (token flow).
>
> Paste-ready prompt: *"Implement docs/plans/0010 starting at Batch A. Failing tests
> first for X-1/X-2. Follow AGENTS.md cardinal rules and the feature-slice and
> add-permission skills. Verify after every batch and stop to report."*

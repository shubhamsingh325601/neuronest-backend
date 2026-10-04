# Plan 0009 — Phase 9: Security Fixes, Contract Fixes, Parent Plan Read

Status: **Done**
Owner: backend
Last updated: 2026-10-04

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **Nothing in this phase has been implemented yet** — it
> was authored from a read-only audit of `docs/NeuroNest_Backend_V1_Developer_Handoff.docx`
> against the code (2026-10-04). Plans 0009–0015 are a set; read
> [README.md](README.md) for how they fit together.

> **DECISION CHANGE (2026-10-04): no IP-based rate limiting.** The B-2 fix (`TRUST_PROXY_HOPS`,
> `app.set(trust proxy)`, per-host hop measurement, row 4/4a, step 2.4) was **removed** because
> client-IP handling differs per platform (Vercel, Render, Hostinger) and costs more than it
> pays at this stage. The limiter now keys on **user id / body email / body token hash**
> (`src/common/throttler/app-throttler.guard.ts`, registered after `JwtAuthGuard`), and requests
> that identify nobody (health) are not limited. B-2 is therefore closed by removing its cause
> (the shared-bucket problem cannot occur when no IP is used). Re-add an IP layer only if real
> traffic needs it. Known gap: one client spraying many different emails is not capped.

---

## 1. Context

The frontend developer's V1 handoff lists ten backend bugs (B-1…B-10) and a parent
plan-content gap. Each claim was checked against the actual code; every one below was
confirmed by reading the code path (no runtime reproduction was possible in the audit
session — each batch's first step re-confirms with a failing test before fixing).

| Docx item | Class | Evidence |
|---|---|---|
| B-1 unverified-account pre-hijack | **BUG** | `src/modules/auth/features/signup/signup.service.ts:22-32` — an existing unverified email only gets a fresh code; the old `passwordHash`/`name` are kept. |
| B-2 proxy-aware rate limit | **BUG** (code-confirmed; runtime unconfirmed) | `src/main.ts` never sets Express `trust proxy`; `ThrottlerGuard` tracks `req.ip`. Behind any reverse proxy every client shares one bucket (the `/auth` limit of 5/min becomes 5/min *for everybody*). |
| B-3 playback URL expiry | **NEEDS PRODUCT DECISION** (partly DONE) | URLs are already `authenticated` + signed (`src/common/media-storage/cloudinary-media-storage.service.ts:86-97`); true expiry needs a paid Cloudinary add-on (plan 0008 §9). Blocked on D-2. **No work here.** |
| B-4 client metadata trusted | **BUG** | `src/modules/media/features/confirm-upload/confirm-upload.service.ts:67-75` persists the DTO's `mimeType`/`sizeBytes`/`durationSeconds`; `verifyUpload` (`cloudinary-media-storage.service.ts:71-84`) returns only a boolean. |
| B-5 `RESEND_API_KEY` empty in prod | **BUG** | `src/common/config/env.validation.ts:55` allows `''`; `src/common/email/resend-email.service.ts:35,53-56` then logs instead of sending. |
| B-6 ACTIVE plan uniqueness | **BUG** | `src/modules/plans/features/assign-plan/assign-plan.service.ts:66-84` is check-then-create; `prisma/schema.prisma` `Plan` has only `@@index([childId])`. |
| B-7 refresh rotation not atomic | **BUG** | `src/modules/auth/shared/refresh-token.service.ts:40-75` — find, then update, then issue. Two concurrent calls with one token can both succeed. |
| B-9 future DOB accepted | **BUG** | `src/modules/children/features/create-child/dto/create-child.dto.ts:11-13` uses only `@IsDateString()` (which also accepts datetimes); `create-child.service.ts:34` has no bound. |
| B-10 `assignedByAdminId` to parent | **BUG** | `src/modules/children/features/list-clinician-assignments/list-clinician-assignments.service.ts:51-55` returns `ClinicianChildAssignmentDto` (incl. `assignedByAdminId`) to a `PARENT`. |
| B / G parent complete plan | **MISSING FEATURE** | `src/modules/plans/features/get-plan/get-plan.service.ts:42` returns `PlanDto`, which has no title/days (`src/modules/plans/shared/plan.dto.ts`); `PARENT` lacks `plan-template:read` (`src/common/authz/permissions.ts:60-67`). Archived templates are **not** filtered anywhere, so the "archived template stays readable" criterion already holds. |
| B-8 stale PENDING media | **MISSING FEATURE** | Needs a scheduler → moved to plan 0011. |

**Extra findings from the audit that belong here** (not in the docx):

- **X-4** `verification-token.service.ts:119-136,155-172` — `consumePasswordResetToken` /
  `consumeAccountSetupToken` are find-then-update; two concurrent requests with one
  token both succeed.
- **X-5** The B-1 fix must not overwrite non-PARENT rows (an INVITED clinician's record
  shares the `users` table and the unverified/null-password shape).
- **X-7** `PlanDto.createdById` (`plan.dto.ts:24-25`) is exposed to parents.
- **X-8** `RefreshTokenService.rotate` never re-checks the user's status
  (`refresh-token.service.ts:74`).

**Out of scope — must not be scaffolded here:** AI (analysis, plan generation, coaching),
parent↔clinician chat, week/goal entities (D-5), timezone changes to Today's Focus
(D-15), upload limits (D-6), playback-URL expiry (B-3/D-2), the background-job queue
(plan 0011), clinician lifecycle (plan 0010).

## 2. Scope

**In:** B-1, B-2, B-4, B-5, B-6, B-7, B-9, B-10, B/G, X-4, X-5, X-7, X-8.

**No new routes.** Changed behaviour/contracts:

- `POST /v1/auth/signup` (behaviour)
- `POST /v1/media/{id}/confirm` (behaviour)
- `GET /v1/children/{id}/clinicians` (parent-facing DTO redaction)
- `GET /v1/plans/{id}` (additive `PlanDetailDto`, parent-safe)
- `POST /v1/children` (stricter validation)
- `POST /v1/auth/refresh` (atomicity; no contract change)

**Parked, documented only:** B-3, D-6, D-15, D-1 (DOB stays required).

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | B-1: re-signup for an unverified **PARENT** replaces `passwordHash` + `name`, revokes all refresh tokens, re-issues the code, in **one transaction**. Response unchanged (`201 {id,email}`). Verified email → `409 EMAIL_ALREADY_REGISTERED` (unchanged). | The token service's `consumeOutstanding` already invalidates earlier codes. Update the "Deliberate idempotency on POST" paragraph in `docs/api-conventions.md` and the signup section of `docs/auth-flows.md`. |
| 2 | X-5: any existing row whose `role !== PARENT` (INVITED clinician, ADMIN) → `409 EMAIL_ALREADY_REGISTERED`, no mutation, no email. | Prevents overwriting an invited clinician through the public signup route. |
| 3 | B-1: a concurrent first-signup race (`P2002` on `users.email`) is caught and re-run through the "existing user" branch instead of surfacing `500`. | |
| 4 | **SUPERSEDED 2026-10-04 (see banner)** — B-2: new env `TRUST_PROXY_HOPS` (integer ≥0, default `0`, **required in production**). `app.set('trust proxy', n)` is applied in a shared `configureApp(app)` used by **both** `main.ts` and `test/helpers/test-app.ts`. | Today `test-app.ts` re-implements `main.ts` by hand, so a `main.ts`-only fix would be untestable. The correct hop count is **verified on each deployed host** (Render, later Hostinger), never guessed. Never `trust proxy: true` (spoofable `X-Forwarded-For`). |
| 4a | **SUPERSEDED (no longer needed)** — **How to find `TRUST_PROXY_HOPS` (measure, don't guess):** deploy a build that temporarily logs `req.headers['x-forwarded-for']` and `req.socket.remoteAddress` for one request, and call it from a device whose public IP you know (e.g. a phone on mobile data). Count the `X-Forwarded-For` entries **to the right of your own IP**, plus one for the connecting proxy: that is the hop count (Render appends rather than replaces, so a fake entry a client sends sits to the *left* and is ignored once the right count is set). Re-measure after any platform change (custom domain, Cloudflare). Hostinger shared hosting is not documented to forward the client IP; if the header is absent there, per-IP limiting cannot work, so use `TRUST_PROXY_HOPS=0` plus an account-keyed (email) limit on the auth routes. | Render reports range from 1 to 3 hops depending on routing. |
| 5 | B-4: replace `MediaStorageService.verifyUpload(): boolean` with `inspectUpload(storageKey, type): Promise<UploadedAssetInfo \| null>` returning `{ bytes, format, mimeType, durationSeconds? }` from the Cloudinary Admin API response (`bytes`, `format`, `resource_type`, `duration`). `null` = not landed. | Confirm persists provider values and **ignores** the request's `mimeType`/`sizeBytes`/`durationSeconds` while still accepting them (compat; fields stay in the DTO, documented "ignored"). `mimeType` = lookup table for common formats (`mp4→video/mp4`, `mov→video/quicktime`, `jpg→image/jpeg` …), fallback `${resource_type}/${format}`. FAILED confirm still stores nulls. `Media.sizeBytes` is `Int` (2 GiB cap) — acceptable, noted in Risks. |
| 6 | B-5: `RESEND_API_KEY` is required and non-empty when `NODE_ENV=production` (Joi `.when`). Dev/test unchanged (empty key still logs the rendered email). | Same pattern as the existing Cloudinary production-required block in `env.validation.ts`. |
| 7 | B-6: partial unique index `plans_one_active_per_child` — `CREATE UNIQUE INDEX ... ON plans (child_id) WHERE status = 'ACTIVE'` — hand-written in the migration (Prisma cannot express partial indexes). `AssignPlanService` maps `P2002` to `409 PLAN_ALREADY_ACTIVE`; the pre-check stays as the friendly fast path. | Migration must **fail loudly** if duplicate ACTIVE plans already exist, with the diagnostic query in §4. After authoring, run `prisma migrate dev --create-only` once and confirm Prisma does **not** emit a DROP for the hand-written index (known drift risk). |
| 8 | B-7: rotation becomes a conditional `updateMany({ id, revokedAt: null })`; `count === 0` → `401 INVALID_REFRESH_TOKEN`. The loser of a race does **not** trigger family revocation (the existing reuse-of-revoked-token path still does). Revoke + issue run in one `$transaction`. | Exactly one concurrent caller succeeds. |
| 9 | X-8: `rotate` refuses a non-`ACTIVE` user (`401 INVALID_REFRESH_TOKEN`, token revoked). | Defence in depth; suspend/deactivate already revoke tokens. |
| 10 | X-4: both link-token consumers become `updateMany({ id, consumedAt: null })` + `count` check; `0` → treated as invalid token. | Same `INVALID_RESET_TOKEN` / `INVALID_SETUP_TOKEN` codes. |
| 11 | B-9: `dateOfBirth` must be date-only `YYYY-MM-DD` (reject datetimes — this **tightens** the contract; the DTO already documents "no time component") and ≤ the UTC date of `now + 14h` (so UTC+14 parents entering their own "today" are not rejected). `400 VALIDATION_ERROR`. No age-range rule. | Tests use `today+2d` for the future case so they are time-of-day independent. Implemented as a reusable custom validator in `src/common/validation/` (path alias, class-validator). |
| 12 | B-10 + X-7: role-aware serialisation. For `PARENT` the care-team response omits `assignedByAdminId`, and plan responses omit `createdById`. Fields become optional in OpenAPI. CLINICIAN/ADMIN shapes unchanged. | Implemented via `from(row, { audience })` helpers on the shared DTOs, not separate DTO classes, to keep OpenAPI small. |
| 13 | B/G: `GET /v1/plans/{id}` returns `PlanDetailDto` = `PlanDto` fields + `title`, `description`, `days[]` (sorted by `dayNumber`, same `PlanTemplateDayDto`). Additive for clinician/admin. **No template-status filter** (an `ARCHIVED` template never makes an assigned plan unreadable). `plans/today` and `GET /children/{id}/plans` unchanged. | Reuses `plan:read` and the existing ownership check; **no new permission**. Parent never gains `plan-template:read`; the plan endpoint is the only door. |
| 14 | D-5: no week/goal entities and no 28-day validation. The response exposes flat `days[]`; "weeks" are derived client-side (`ceil(dayNumber / 7)`). | |
| 15 | D-1 / D-15 / D-6 / B-3: unchanged and recorded as parked. DOB stays required; Today's Focus stays UTC (`src/modules/plans/features/today-focus/day-offset.util.ts`). | |

## 4. Data model

**One migration, no new tables, no Prisma-model change.** `prisma/migrations/<ts>_plans_one_active_per_child/migration.sql`:

```sql
-- Pre-flight: abort if any child already has more than one ACTIVE plan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plans WHERE status = 'ACTIVE' GROUP BY child_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate ACTIVE plans exist — resolve before applying (see plan 0009 §4)';
  END IF;
END $$;

CREATE UNIQUE INDEX plans_one_active_per_child ON plans (child_id) WHERE status = 'ACTIVE';
```

Operator diagnostic (run on the target DB *before* deploying):

```sql
SELECT child_id, count(*) FROM plans WHERE status = 'ACTIVE' GROUP BY child_id HAVING count(*) > 1;
```

Resolve duplicates by archiving all but the intended plan (`UPDATE plans SET status='ARCHIVED' ...`).

- `truncateAll()` — **no change** (no new table).
- `schema.prisma` — add a comment above `Plan` noting the hand-written partial index so the next author does not drop it.
- `docs/schema-decisions.md` — one note under `Plan` for the partial index.

## 5. Endpoints

No new routes. Changed contracts:

| Method | Path | operationId | Auth | Change |
|--------|------|-------------|------|--------|
| `POST` | `/v1/auth/signup` | `authSignup` | `@Public()` | B-1/X-5: replace credentials for unverified PARENT; `409` for any non-PARENT or verified row; response shape unchanged. |
| `POST` | `/v1/auth/refresh` | `authRefresh` | `@Public()` | B-7/X-8: atomic rotation; loser `401 INVALID_REFRESH_TOKEN`. |
| `POST` | `/v1/auth/reset-password` | `authResetPassword` | `@Public()` | X-4: single-use under concurrency. |
| `POST` | `/v1/auth/complete-account-setup` | `authCompleteAccountSetup` | `@Public()` | X-4: single-use under concurrency (status guard is plan 0010). |
| `POST` | `/v1/media/{id}/confirm` | `mediaConfirmUpload` | `@Auth('media:create:self')` | B-4: provider-verified metadata persisted; body fields accepted but ignored. |
| `GET` | `/v1/children/{id}/clinicians` | `childClinicianList` | `@Auth('child:read')` | B-10: `assignedByAdminId` omitted for PARENT. |
| `GET` | `/v1/plans/{id}` | `planGet` | `@Auth('plan:read')` | B/G: returns `PlanDetailDto` (`title`, `description`, `days[]`); `createdById` omitted for PARENT. |
| `GET`/`POST` | `/v1/children/{childId}/plans`, `/plans/today`, `POST .../plans` | existing | existing | X-7: `createdById` omitted for PARENT (today and list only; no other change). |
| `POST` | `/v1/children` | `childCreate` | `@Auth('child:create:self')` | B-9: date-only, not in the future. |

Shared DTO changes: `PlanDto` (audience-aware), new `PlanDetailDto` (`src/modules/plans/shared/`), `ClinicianChildAssignmentDto` (audience-aware), `ConfirmUploadDto` (fields documented "ignored").

## 6. Cross-cutting

- **Permissions** — none added or changed. `docs/rbac.md` §6 gets one short note: "`GET /v1/plans/{id}` for PARENT now returns template content; the template stays unreachable by id (`plan-template:read` not granted)".
- **Config** — new `TRUST_PROXY_HOPS` (`configuration.ts`, `env.validation.ts`, `.env.example`). `RESEND_API_KEY` becomes production-required. Document both in `README.md`'s env table and `docs/architecture.md`.
- **Bootstrap** — new `src/common/bootstrap/configure-app.ts` holding versioning, `ValidationPipe`, exception filter, OpenAPI, trust-proxy; `main.ts` and `test/helpers/test-app.ts` both call it (CORS stays in `main.ts` if the e2e suite does not need it).
- **Errors** — no new codes (`PLAN_ALREADY_ACTIVE`, `INVALID_REFRESH_TOKEN`, `EMAIL_ALREADY_REGISTERED`, `VALIDATION_ERROR` all exist).
- **OpenAPI** — no `EXPECTED` row changes (no new routes); the drift test must still pass after the DTO changes.
- **`rbac-route-coverage`** — unchanged; must still pass.
- **Cardinal rules** — path aliases only; no repository layer; strict DTOs (the new validator is class-validator); no enumeration (signup keeps `201` for new/unverified and `409` only for verified/non-parent — the same disclosure as today); tokens stay hashed.

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Auth correctness

- [x] **1.0** Re-confirm each finding with a **failing test first** (B-1: signup A then B, A still logs in after verify; B-7: `Promise.all` of two refreshes both 200; X-4: `Promise.all` of two resets both 200).
- [x] **1.1** B-1/X-5 `SignupService` — transaction, role guard, `P2002` handling; unit spec.
- [x] **1.2** X-4 `VerificationTokenService.consume*` conditional update; unit spec.
- [x] **1.3** B-7/X-8 `RefreshTokenService.rotate` conditional update + transaction + status check; unit spec.
- [x] **1.4** e2e: extend `test/auth.e2e-spec.ts` — signup A/B (only B authenticates after verify; A rejected; response shape unchanged), verified→409, invited-clinician-email→409 with no mutation, concurrent refresh (exactly one 200, other 401 `INVALID_REFRESH_TOKEN`), concurrent reset.
- [x] **1.5** Verify: `npm run lint && npm test && npm run build && npm run test:e2e` green.

### Batch 2 — Config and infrastructure

- [x] **2.1** B-5 Joi production rule + unit/e2e-free check (env validation spec); `.env.example` comment.
- [x] **2.2** B-2 extract `configureApp()`; add `TRUST_PROXY_HOPS`; wire `main.ts` + `test-app.ts`.
- [x] **2.3** e2e: with hops=1, two `X-Forwarded-For` IPs have independent `/auth` buckets; six requests from one IP → 429 on the sixth without consuming the other's bucket; hops=0 ignores the header.
- [x] **2.4 (cancelled 2026-10-04: no IP limiting, nothing to measure)** **On the deployed host** (Render now, Hostinger later): send requests with distinct client IPs, confirm the hop count, set `TRUST_PROXY_HOPS`. Record the verified value in this file.
- [x] **2.5** Verify full suite.

### Batch 3 — Media metadata (B-4)

- [x] **3.1** `MediaStorageService.inspectUpload` + `CloudinaryMediaStorageService` impl + `FakeMediaStorageService.simulateAsset()`; unit specs for the format→MIME table.
- [x] **3.2** `ConfirmUploadService` persists provider values, ignores body; mark DTO fields "ignored" in `@ApiPropertyOptional` descriptions.
- [x] **3.3** e2e: extend `test/media-upload.e2e-spec.ts` — forged `sizeBytes`/`mimeType`/`durationSeconds` ignored; UPLOADED and FAILED outcomes; PHOTO has null duration.
- [x] **3.4** Verify full suite.

### Batch 4 — Data and contracts

- [x] **4.0** Run the §4 diagnostic against dev and prod databases; resolve duplicates first.
- [x] **4.1** B-6 migration (§4) + `AssignPlanService` `P2002` mapping; `npx prisma migrate dev --create-only` drift check; comment in `schema.prisma`.
- [x] **4.2** B-9 date validator + `CreateChildDto`; unit spec.
- [x] **4.3** B-10/X-7 audience-aware DTOs; update all plan/assignment call sites.
- [x] **4.4** B/G `PlanDetailDto` + `GetPlanService`.
- [x] **4.5** e2e: `plan-domain` (parent gets title + all days; other parent 403; archived template still readable; clinician/admin shape additive; `createdById` absent for parent), concurrent `planAssign` (one 201, one 409 `PLAN_ALREADY_ACTIVE`), `child-care-domain` (parent care-team response has no `assignedByAdminId`; admin/clinician still do), child DOB (future 400, today OK, past OK, datetime 400).
- [x] **4.6** Verify full suite.

### Batch 5 — Docs and close

- [x] **5.1** Update `docs/api-conventions.md` (signup paragraph), `docs/auth-flows.md`, `docs/rbac.md` note, `docs/schema-decisions.md`, `.env.example`, README env table.
- [x] **5.2** Flip this file's Status to **Done**, update `docs/plans/README.md`, write the implementation summary (files, env vars, migration name, tests, verified proxy hop count).

## Testing

- **Unit:** `signup`, `refresh-token`, `verification-token`, `confirm-upload`, `cloudinary-media-storage` (format table), `assign-plan` (P2002), `create-child` + date validator, DTO audience helpers.
- **E2E:** `auth`, `media-upload`, `plan-domain`, `child-care-domain`, plus a throttling spec for B-2.
- **`docs.e2e-spec` EXPECTED:** no rows added/removed.
- **`rbac-route-coverage`:** unchanged and must pass.
- Do not weaken or delete any existing passing test.

## Risks and open questions

- **(Superseded 2026-10-04 — IP limiting removed.)** **Proxy hops differ per host** and an incorrect value either shares one bucket (too low) or lets clients spoof their IP (too high). Verify on each deployment; Hostinger Business may add a different proxy chain than Render.
- **Partial unique index drift** — Prisma may not understand the hand-written index; verify with `migrate dev --create-only`; keep the schema comment.
- **DOB contract tightening** — frontend confirmed (2026-10-04) it sends a plain date, so date-only is safe.
- **`Media.sizeBytes` is `Int`** — videos over ~2 GiB overflow; widen to `BigInt` only if D-6 allows files that large.
- **Provider metadata lag** — Cloudinary may not report video `duration` immediately; if absent, store `null` rather than trusting the client.
- **(Superseded 2026-10-04.)** **Proxy hop count — research result (2026-10-04):** see §3 row 4a. Public reports for Render conflict (1 to 3 hops), and nothing authoritative is published for Hostinger shared hosting, so the value **must be measured per host** (row 4a gives the procedure). Decision: default `0`, set per environment after measuring; never `true`.
- D-1 stays "required" unless product says otherwise.

## 8. How to resume

> Nothing is implemented yet. Start at Batch 1, step 1.0. Mirror existing precedents:
> `deactivate.service.ts` for transaction + revoke, `reset-password.service.ts` for the
> token consumers, `list-media.service.ts` for ownership checks. Keep the repo buildable
> after each batch — the verify steps are not optional.
>
> Paste-ready prompt: *"Implement docs/plans/0009 batch by batch starting at Batch 1.
> Re-confirm each bug with a failing test before fixing. Follow AGENTS.md cardinal rules.
> Run lint, unit, build and e2e after every batch and stop to report at each verify step."*

## 9. Implementation summary

Delivered in two sittings (Batches 1–3, then Batch 4–5) on 2026-10-04. Final verification:
`npm run lint`, `npm test` (393), `npm run build`, `npm run test:e2e` (277) all green.

**What shipped**

| Item | Where |
|---|---|
| B-1 / X-5 signup re-claim, non-PARENT → 409, `P2002` race | `auth/features/signup/signup.service.ts` |
| X-4 single-use link tokens | `auth/shared/verification-token.service.ts` (`claim`) |
| B-7 / X-8 atomic rotation, non-ACTIVE refused | `auth/shared/refresh-token.service.ts` |
| B-5 `RESEND_API_KEY` required in production | `common/config/env.validation.ts` (+ spec) |
| B-4 provider-verified media metadata | `MediaStorageService.inspectUpload`, `mime-type.util.ts`, `confirm-upload.service.ts` |
| B-6 one ACTIVE plan per child | migration `20261004180000_plans_one_active_per_child`; `P2002` → `409 PLAN_ALREADY_ACTIVE` in `assign-plan.service.ts` |
| B-9 date-only, not-future DOB | `common/validation/is-date-only-not-future.decorator.ts`, `CreateChildDto` |
| B-10 / X-7 parent redaction | `ClinicianChildAssignmentDto.from(row, { audience })`, `PlanDto.from(row, { audience })` |
| B/G parent plan read | delivered by plan 0016 (`PlanDetailDto` with `days[]`/`sections[]`); 0009 added the parent-safe redaction and the e2e proof |

**Deviations from the plan as written**

- **B-2 / `TRUST_PROXY_HOPS` (§3 rows 4/4a, steps 2.2–2.4) was superseded** by the
  2026-10-04 decision in `docs/plans/README.md`: no IP-based rate limiting; limits key on
  user id / email / token. The `configureApp()` extraction from this plan stayed and is
  used by `main.ts` and the e2e test app. No hop count was ever measured.
- **Migration SQL used `"childId"`, not `child_id`.** The plan's SQL assumed a snake_case
  column, but `Plan.childId` has no `@map`. Corrected in the migration and the operator
  diagnostic (§4 text above still shows the original; use `"childId"`).
- **Step 4.0 diagnostic** ran against the dev database only (zero duplicate ACTIVE plans).
  **It has not been run against production** — run
  `SELECT "childId", count(*) FROM plans WHERE status = 'ACTIVE' GROUP BY "childId" HAVING count(*) > 1;`
  there before deploying, because the migration aborts on duplicates.
- `prisma migrate diff` (migrations vs schema) against the local test database was empty
  after the hand-written index, so Prisma will not emit a DROP for it.
- The B-7 race is not reliably reproducible over HTTP on a fast local database, so the
  deterministic regression guard is the `refresh-token.service` unit spec; the e2e keeps
  an "exactly one of two succeeds" assertion. B-6 and X-4 races did reproduce at e2e level.
- Provider-reported `duration` is rounded to whole seconds (the column is `Int`).

**Env:** `RESEND_API_KEY` now required in production. No other variables added or kept
(`TRUST_PROXY_HOPS` removed by the later throttle refactor).

**Not done / parked as planned:** B-3 playback expiry (D-2), D-1, D-6, D-15, B-8 (plan 0011).

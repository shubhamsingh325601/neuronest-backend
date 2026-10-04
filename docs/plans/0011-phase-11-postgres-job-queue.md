# Plan 0011 — Phase 11: Postgres Job Queue, Async Email, Stale-Media Cleanup

Status: **Done**
Owner: backend
Last updated: 2026-10-04 (implemented)

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. **This phase is implemented — see §9 for the summary.**
> Assumes plan 0010's `InvitationService` exists (it becomes a job handler here).

---

## 1. Context

The docx (§D) asks for "background execution": event-triggered and recurring jobs,
retryable failures, no double processing, enough observability to diagnose failures —
and says to use "the existing architecture/provider choice". **None exists**: no queue,
no Redis, no scheduler, `@nestjs/schedule` is not in `package.json`. B-8 (stale `PENDING`
media) needs a recurring job.

Product decisions already made (not relitigated): async email with **no Redis/BullMQ**
(cost); a single Postgres `Job` table is both transactional outbox and queue; claim with
`FOR UPDATE SKIP LOCKED`; exponential backoff with jitter; `DEAD` is the error list and
an admin can requeue; a 10-minute `@nestjs/schedule` sweep; a post-commit "kick"; email
failure never rolls back business data; in-memory cache for reads only, never jobs.

**Hosting (answered):** Render free plan now, then a Hostinger Business shared plan (not
a VPS). Both can sleep or kill the Node process (Render free sleeps after ~15 min idle
and redeploys restart it), so the design must not depend on an in-process cron alone:
jobs live in Postgres and survive restarts; the app runs a catch-up pass on boot;
SIGTERM releases held jobs; and a secret-guarded endpoint lets an external cron/pinger
trigger a run.

**Problem this also fixes (audit X-3):** email is sent inline today. A provider failure
makes `forgot-password` / `resend-verification` return `500` only when the account
exists — an **account-enumeration oracle** (cardinal rule 6) — and `signup` can leave a
user with no code (`forgot-password.service.ts:30-32`, `verify-email.service.ts:46-52`,
`resend-email.service.ts:65-68`).

**Out of scope:** Redis/BullMQ, AI jobs (analysis, coaching generation), escalation
breach alerting (D-3), WhatsApp/SMS, any in-memory job queue, multi-region concerns.

### Hosting trade-off accepted (decided 2026-10-04)

Hostinger Business will **not** keep the Node process running between requests, and Render free sleeps when idle. Decision: **accept it** — no external pinger or scheduler is bought or built for now. Consequences, stated plainly:

- Jobs are always safe in Postgres; nothing is lost when the process stops.
- Work resumes **whenever the process next starts or serves a request**: the boot catch-up pass and the post-commit kick are the real drivers on these hosts; the in-process 10-minute sweep only runs while the process happens to be alive (a bonus, not a guarantee).
- A retry that comes due while the app is asleep waits until the next start/request, and the admin can press **Run pending jobs now** at any time. First emails (the common case) are sent immediately by the kick during the same request, so they are unaffected.
- When real users arrive, moving to a VPS (always-on) needs **no code change**: the sweep timer simply becomes reliable. Optionally add the external trigger (row 11) at that point.

## 2. Scope

**In:** `jobs` table + queue core in `src/common/jobs/`; runner with four triggers;
retry/backoff/DEAD; admin job list/get/requeue; email moved onto the queue (signup,
resend-verification, forgot-password, clinician invitation); recurring stale-media
cleanup (B-8); admin-summary `deadJobs`; config; tests.

**Out:** see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | **Chosen approach: custom Postgres outbox/queue, not pg-boss.** | pg-boss owns its own schema + runtime migrations, runs its own connection pool (a second pool against a pooled Neon DB), relies on advisory locks (the repo already documents pooler/advisory-lock hazards in `docs/database-and-docker.md`), and cannot join the **Prisma business transaction** without adapter glue — which defeats the outbox guarantee (job row committed atomically with business data). Our needs are one small job class; ~300 lines. |
| 2 | Table `jobs` (§4). `type` is plain text validated against a code registry (adding a job type needs no migration). `payload` is JSONB. | |
| 3 | **Claim** is one statement: `UPDATE jobs SET status='RUNNING', locked_at=now(), locked_by=$1, attempts=attempts+1 … WHERE id IN (SELECT id FROM jobs WHERE status='PENDING' AND run_at<=now() ORDER BY priority DESC, run_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING *` via `$queryRaw`. | No explicit transaction, no session advisory locks → safe through Neon's transaction-mode pooler. `attempts` increments at claim so a crash loop still terminates. |
| 4 | **Completion is fenced:** `… WHERE id=$ AND status='RUNNING' AND locked_at=$claimedAt`. | A stale worker resurrected after the sweep reset cannot overwrite a re-claimed job. |
| 5 | **Retry:** equal-jitter exponential backoff — `d = min(cap, base·2^attempts)`, delay = `d/2 + rand(d/2)`; defaults base 30 s, cap 1 h; `maxAttempts` default 5. At `maxAttempts` → `DEAD`. | Backoff is a pure function with an injectable RNG (unit-testable). |
| 6 | **`DEAD` is the error list.** Admin can requeue: `PENDING`, `attempts=0`, `runAt=now`, `lastError` kept. Only `DEAD` rows can be requeued (`409 JOB_NOT_DEAD`). Sentry is notified **only** when a job turns `DEAD`, not on every retry. | `lastError` is truncated (≤1000 chars). |
| 7 | **Payloads never contain secrets** (cardinal rule 7). Email jobs carry only `{ userId }` (+ purpose in `type`). The **handler mints the token/code at send time** (which also invalidates earlier ones), builds the URL, and sends. | At-least-once delivery means a rare duplicate email can invalidate the first link — accepted and documented. Review checklist item: no raw token/code in `payload` or `lastError`. |
| 8 | **Handlers re-check state at run time**; if the precondition is gone (clinician no longer `INVITED`, user already verified) the job completes as a no-op `SUCCEEDED`. | Stops late emails after a suspend/verify. |
| 9 | **`dedupeKey`** (nullable, unique) makes enqueue idempotent: `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`. Keys: `email.verification-code:{userId}:{minuteBucket}`, `email.account-setup:{userId}:{requestNonce}` for explicit resends, `media.expire-stale-pending:{hourBucket}`. | Double-clicks collapse; deliberate resends use a fresh key. |
| 10 | **Four triggers, one `JobRunnerService.runDue()`** (overlap-safe thanks to `SKIP LOCKED`): (a) **post-commit kick** — fire-and-forget, coalesced to one loop per process, never throws into the request; (b) **`@nestjs/schedule` sweep every 10 min** — runs due retries, resets stale `RUNNING`, prunes old `SUCCEEDED`, enqueues recurring jobs; (c) **boot catch-up** (started after the HTTP server is listening, never blocking startup) in `OnApplicationBootstrap` — runs the sweep immediately so a redeploy/restart resumes work and never "forgets" it; (d) **admin-run trigger** — the admin dashboard has a "Run pending jobs now" button calling `POST /v1/admin/jobs/run-due` (`job:manage`); the secret-guarded machine trigger (row 11) is **optional and off by default** (no external scheduler is committed to yet). | Timers are never the source of truth — only `run_at` in Postgres is. Optional (batch 5.x): re-arm one in-process timer for the earliest pending `run_at` (≤ sweep interval) so a 30 s retry does not wait 10 min. |
| 11a | **Admin "run pending jobs"** (decided 2026-10-04): `POST /v1/admin/jobs/run-due` → `200 { claimed, succeeded, retried, dead }`, `@Auth('job:manage')`, ADMIN only. Authenticated, so no shared secret and no `@Public()` exception. This is the primary manual driver; with kick + boot catch-up + the in-process sweep it is enough while hosting is free-tier. | The same screen can `requeue` DEAD rows. |
| 11 | **Optional machine trigger** (build only when an external scheduler is chosen) `POST /v1/jobs/run-due`: `@Public()` **plus** a guard comparing header `X-Jobs-Token` to `JOBS_RUN_TOKEN` in constant time (`crypto.timingSafeEqual`, ≥32-char token). Unset token → route returns `404` (disabled). Returns `200 { claimed, succeeded, retried, dead }`. Covered by the global throttler. | The documented exception to "explicit `@Auth`" (machine caller, no user). A free external cron/pinger (e.g. GitHub Actions schedule, cron-job.org, hPanel cron `curl`) calls it every ~10 min — on Render free this also keeps retries moving while the instance sleeps (a request wakes it; note a pinger defeats scale-to-sleep, which is acceptable). Add an `rbac.md` note. |
| 12 | **Visibility timeout** 5 min: `RUNNING` rows with `locked_at` older than that go back to `PENDING` (or `DEAD` if `attempts >= maxAttempts`). Handlers are wrapped in a per-job timeout (60 s) so they finish well inside it. | |
| 13 | **Graceful shutdown:** `OnApplicationShutdown` stops claiming, waits for in-flight jobs up to a grace period (default 20 s, under Render's 30 s SIGTERM→SIGKILL window), then **releases** this instance's `RUNNING` rows (`locked_by = instanceId`) to `PENDING` with `attempts = attempts - 1` (a deploy is not the job's fault). | `instanceId = hostname + pid + boot uuid`. |
| 14 | **Email migration:** `signup`, `resend-verification`, `forgot-password`, clinician create/resend/email-change **enqueue inside their transaction and kick after commit**. HTTP status codes stay the same (201, 202, 202, plan 0010's codes). | Removes the X-3 enumeration oracle. The residual difference (a cheap insert only when the account exists) is negligible next to the removed network call. |
| 15 | **B-8 stale media** is a recurring job `media.expire-stale-pending`, enqueued by the sweep with an hourly `dedupeKey` (so a failing run shows up in the DEAD list): `UPDATE media SET status='FAILED' WHERE status='PENDING' AND created_at < now() - ttl`. Threshold env `MEDIA_PENDING_TTL_HOURS` (**default 24, to be confirmed** — not invented as a product rule). | Existing confirm behaviour preserved: re-confirm FAILED with FAILED is a no-op; UPLOADED after FAILED is `409 MEDIA_ALREADY_CONFIRMED` (parent requests a new ticket). The generous default avoids failing a slow upload. |
| 16 | `kick` is **never** required for correctness — if a kick is lost, the sweep/boot/machine trigger picks the job up. | |
| 17 | **Test mode:** `JOBS_KICK_MODE=inline` (set in `test/helpers/setup-e2e.ts`) makes the kick awaited inside the request, so existing e2e specs that read `ctx.mail` synchronously keep passing. A `ctx.jobs.drain()` helper plus direct `runAt` edits cover async/retry cases. The cron is disabled in tests (`JOBS_ENABLED=false`). | |
| 18 | In-memory cache: allowed for reads only; **none is needed** in this phase. | |
| 19 | New dependency: `@nestjs/schedule`. | Flag in the implementation summary. |

## 4. Data model

```prisma
enum JobStatus {
  PENDING
  RUNNING
  SUCCEEDED
  DEAD
}

model Job {
  id          String    @id @default(uuid()) @db.Uuid
  type        String
  payload     Json
  status      JobStatus @default(PENDING)
  priority    Int       @default(0)
  runAt       DateTime  @default(now())
  attempts    Int       @default(0)
  maxAttempts Int       @default(5)
  lastError   String?
  lockedAt    DateTime?
  lockedBy    String?
  dedupeKey   String?   @unique
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status, priority(sort: Desc), runAt])
  @@map("jobs")
}
```

- **Migration** `…_add_jobs` — new table + enum; additive, safe on existing data. A partial index on `(priority desc, run_at) WHERE status='PENDING'` is an optional hand-written refinement; not needed at current volume.
- **`truncateAll()`** (`prisma.service.ts`): add `'jobs'` (no FKs, order-insensitive).
- Retention: `SUCCEEDED` rows older than `JOBS_SUCCEEDED_RETENTION_DAYS` (default 14) are deleted by the sweep; their `dedupeKey`s become reusable. `DEAD` rows are never auto-deleted.
- `docs/schema-decisions.md`: add a `Job` section (outbox + queue rationale, no secrets in payload).

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `GET` | `/v1/admin/jobs` | `jobList` | `@Auth('job:read')` | Admin only. `?status=&type=&cursor=&limit=`; cursor-paginated `(createdAt desc, id desc)`. |
| `GET` | `/v1/admin/jobs/{id}` | `jobGet` | `@Auth('job:read')` | `404 JOB_NOT_FOUND`. |
| `POST` | `/v1/admin/jobs/{id}/requeue` | `jobRequeue` | `@Auth('job:manage')` | `200` + job. `409 JOB_NOT_DEAD`. |
| `POST` | `/v1/admin/jobs/run-due` | `jobRunDueAdmin` | `@Auth('job:manage')` | Admin dashboard button. `200` summary counts. |
| `POST` | `/v1/jobs/run-due` | `jobRunDue` | `@Public()` + `X-Jobs-Token` guard | **Optional / deferred** machine trigger; `404` when `JOBS_RUN_TOKEN` unset (the default); `401 INVALID_JOBS_TOKEN` on mismatch. |
| `GET` | `/v1/admin/summary` | `adminSummaryGet` | `admin-summary:read` | Additive field `deadJobs`. |

Behaviour changes with **no contract change**: `POST /v1/auth/signup`, `/resend-verification`, `/forgot-password`, plan 0010's clinician create/resend/email-change now enqueue.

`JobDto`: `{ id, type, status, priority, runAt, attempts, maxAttempts, lastError, lockedAt, dedupeKey, createdAt, updatedAt, completedAt }`. `payload` is included (no secrets by construction).

## 6. Cross-cutting

- **Layout** — queue core in `src/common/jobs/` (`JobQueueService.enqueue(tx|prisma, spec)`, `kick()`, `JobRunnerService`, `JobHandlerRegistry`, `backoff.ts`, `JobsModule` global); handlers live next to their domain (`src/modules/auth/jobs/`, `src/modules/clinicians/jobs/`, `src/modules/media/jobs/`) and register in `onModuleInit`. Admin routes in `src/modules/admin/features/{list-jobs,get-job,requeue-job}/`; the trigger in `src/modules/jobs/features/run-due/`. No repository layer.
- **Permissions** — new `job:read`, `job:manage` (ADMIN only) in `permissions.ts`; `rbac.md` notes, including the `@Public()` + token exception for `run-due`.
- **Config** (all validated in `env.validation.ts`, documented in `.env.example`): `JOBS_ENABLED` (default true; false in tests), `JOBS_SWEEP_CRON` (default `0 */10 * * * *`), `JOBS_VISIBILITY_TIMEOUT_SEC` (300), `JOBS_BATCH_SIZE` (10), `JOBS_BACKOFF_BASE_SEC` (30), `JOBS_BACKOFF_CAP_SEC` (3600), `JOBS_MAX_ATTEMPTS` (5), `JOBS_SUCCEEDED_RETENTION_DAYS` (14), `JOBS_SHUTDOWN_GRACE_SEC` (20), `JOBS_KICK_MODE` (`async` | `inline`), `JOBS_RUN_TOKEN` (optional, ≥32 chars), `MEDIA_PENDING_TTL_HOURS` (24).
- **Observability** — Pino lines `jobId/type/attempt/durationMs/outcome`; Sentry capture on `DEAD`; admin list/summary is the "error list".
- **Errors** — new `JOB_NOT_FOUND`, `JOB_NOT_DEAD`, `INVALID_JOBS_TOKEN`.
- **Multi-instance** — each instance runs the sweep; `SKIP LOCKED` + fenced completion make that safe; stale reset is idempotent.
- **Neon scale-to-zero** — a 10-minute sweep wakes the compute periodically (cold-start + compute-hours cost). Accept; the sweep is a single cheap indexed query.
- **Hostinger shared plan** — does not keep Node alive (confirmed 2026-10-04); kick + boot catch-up (started after the server is listening, cheap when nothing is due) + admin button are the drivers; delayed retries accepted until a VPS.
- **OpenAPI/tests** — four new `EXPECTED` rows (`jobList`, `jobGet`, `jobRequeue`, `jobRunDue`); `rbac-route-coverage` must pass (`run-due` is explicitly `@Public()`).
- **Docs** — `architecture.md` (queue seam + trigger model), `auth-flows.md` (email is async; codes unchanged), `testing.md` (`JOBS_KICK_MODE`, `drain()`), `database-and-docker.md` (no session advisory locks rule), `api-conventions.md` (202 now genuinely async).

## 7. Build order (ordered checklist — nothing started yet)

### Batch 1 — Queue core (done)

- [x] **1.0** `npm i @nestjs/schedule`; confirm it resolves under the repo's path-alias/ts-jest setup.
- [x] **1.1** Migration + `Job` model + `truncateAll()`.
- [x] **1.2** `backoff.ts` (+ unit spec), `JobQueueService.enqueue` (tx-aware, dedupe), `JobHandlerRegistry`.
- [x] **1.3** `JobRunnerService.runDue()` — claim, run with timeout, fenced complete/fail, DEAD + Sentry; unit specs with mocked Prisma.
- [x] **1.4** Triggers: `kick()` (coalesced, inline mode), `@Cron` sweep, `OnApplicationBootstrap` catch-up, `OnApplicationShutdown` release, `run-due` route + guard.
- [x] **1.5** Config + `.env.example` + `setup-e2e.ts` (`JOBS_KICK_MODE=inline`, `JOBS_ENABLED=false`); `ctx.jobs.drain()` helper in `test-app.ts`.
- [x] **1.6** e2e `test/jobs.e2e-spec.ts`: dedupe, two concurrent runners process each job once, retry → backoff `runAt` moves, `maxAttempts` → DEAD, stale `RUNNING` reset, release-on-shutdown, run-due guard (404 unset, 401 bad token, 200 good).
- [x] **1.7** Verify: `npm run lint && npm test && npm run build && npm run test:e2e`.

### Batch 2 — Admin surface (done)

- [x] **2.1** Permissions `job:read`/`job:manage` + `rbac.md`.
- [x] **2.2** `list-jobs`, `get-job`, `requeue-job` feature slices; `deadJobs` in summary; `docs.e2e-spec.ts` rows.
- [x] **2.3** e2e: admin sees DEAD, requeue works, non-DEAD 409, non-admin 403.
- [x] **2.4** Verify full suite.

### Batch 3 — Email onto the queue (done)

- [x] **3.1** Handlers `email.verification-code`, `email.password-reset`, `email.account-setup` (call `VerificationTokenService` mint + `EmailService`; re-check state; no-op when stale).
- [x] **3.2** Rewire `signup` (user + job in one transaction), `resend-verification`, `forgot-password`, plan 0010's clinician flows (`InvitationService.issueAndSend` is now the handler body).
- [x] **3.3** Tests: unit specs per handler; e2e — provider throws → business row still committed → job retries → DEAD → requeue succeeds; **enumeration check:** `forgot-password` and `resend-verification` return identical `202` whether or not the provider fails and whether or not the account exists; signup never leaves a user without a queued job.
- [x] **3.4** Update existing e2e specs only where they depended on synchronous send (inline kick mode should make most untouched).
- [x] **3.5** Verify full suite.

### Batch 4 — Stale media (B-8) (done)

- [x] **4.1** `MEDIA_PENDING_TTL_HOURS`; handler `media.expire-stale-pending`; sweep enqueues it with an hourly `dedupeKey`.
- [x] **4.2** e2e: stale vs recent `PENDING` rows (back-date `createdAt` via Prisma), only stale flip to FAILED; re-confirm FAILED idempotent; UPLOADED after FAILED → 409; running twice is a no-op.
- [x] **4.3** Verify full suite.

### Batch 5 — Hardening and close (done)

- [ ] **5.1** (Optional) earliest-`run_at` re-armed timer — **not built** (optional; the sweep, kick, boot catch-up and admin button cover the accepted hosting trade-off).
- [ ] **5.2** Deployment notes — **only the local half is done**: a boot catch-up was verified by starting the built app (`node dist/main.js`, `JOBS_ENABLED=true`) against the local throwaway Postgres, which enqueued and ran `media.expire-stale-pending` ~1 s after start. Verifying a redeploy/cold start on Render and Hostinger is **still to do on those hosts**; `JOBS_RUN_TOKEN` stays unset (no external trigger).
- [x] **5.3** Docs pass (§6), flip Status to **Done**, update `docs/plans/README.md`, write the implementation summary (files, env vars, migration, new dependency, tests).

## Testing

- **Unit:** backoff (RNG injected), enqueue/dedupe, claim SQL wrapper (mocked), fenced complete/fail, handlers (state re-check), run-due guard, registry.
- **E2E:** `jobs`, `admin-summary`, `auth` (async email, enumeration), `clinician-lifecycle` (email failure), `media-upload` (cleanup), `docs`, `rbac-route-coverage`.
- **`docs.e2e` EXPECTED:** `jobList`, `jobGet`, `jobRequeue`, `jobRunDue`.

## Risks and open questions

- **Render free sleeps** — retries and recurring jobs only progress while the instance is awake or an external pinger calls `run-due`. Without a pinger, a retry scheduled while asleep waits for the next inbound request (boot/kick catch-up then runs it).
- **At-least-once email** — a crash between send and mark-SUCCEEDED re-sends with a *new* token, invalidating the first link. Rare; acceptable.
- **Hostinger shared hosting** does not keep Node alive (confirmed by the owner, 2026-10-04): kick + boot catch-up + admin button are the drivers there; delayed retries are an accepted trade-off until a VPS.
- **Raw `$queryRaw` claim** is the one place Prisma's types do not help — cover it with the concurrency e2e.
- **Cron `@nestjs/schedule` + Neon** wake-ups cost compute hours.
- **Resolved 2026-10-04:** no external scheduler is committed (admin button + in-process triggers suffice for now); `MEDIA_PENDING_TTL_HOURS = 24` confirmed; `@nestjs/schedule` accepted (standard Nest cron module, needed for the sweep). Hostinger Business does not persist the Node process (confirmed) — trade-off accepted, revisit at the VPS move.
- Email, SMS and push (Firebase) notifications to parents are **deferred**; the queue is designed so they are just new job types.

## 8. How to resume

> Implemented — see §9. Remaining: 5.1 (optional timer) and the on-host half of 5.2. Precedents: `Job` mirrors the
> `VerificationToken` single-use semantics; handlers mirror the existing services they
> replace (`forgot-password.service.ts`, `verify-email.service.ts`).
>
> Paste-ready prompt: *"Implement docs/plans/0011 batch by batch from Batch 1. Payloads
> must never hold raw secrets. Use a single-statement SKIP LOCKED claim, no session
> advisory locks. Verify after every batch and stop to report."*

---

## 9. Implementation summary

Implemented 2026-10-04 in five batches (1 queue core → 2 admin surface → 3 email on the
queue → 4 stale media → 5 docs/close), each verified with `npm run lint && npm test && npm
run build && npm run test:e2e` before committing. Final: 332 unit tests / 65 suites, 230 e2e
tests / 18 suites, all green.

**Batch 1 — queue core (`src/common/jobs/`)**
- `Job` model + `JobStatus` enum; `truncateAll()` includes `jobs`.
- `backoff.ts` (equal-jitter, injectable RNG), `JobHandlerRegistry` (handlers + recurring
  jobs), `JobQueueService` (`enqueue(tx, spec)` with `ON CONFLICT ("dedupeKey") DO NOTHING`;
  `kick()` coalesced, inline in tests), `JobRunnerService` (single-statement `SKIP LOCKED`
  claim, fenced complete/fail, per-job 60 s timeout, DEAD + Sentry, `reapStale`, prune,
  `releaseHeld`/`onModuleDestroy`), `JobSweepService` (cron + boot catch-up),
  `JobsModule` (global).
- `POST /v1/jobs/run-due` (`@Public()` + `JobsTokenGuard`, `404` unless `JOBS_RUN_TOKEN`
  is set, `401 INVALID_JOBS_TOKEN`). Built (not left deferred) because the plan's checklist
  and `EXPECTED` list required it; it is off by default.
- Test seams: `JOBS_ENABLED=false` / `JOBS_KICK_MODE=inline` in `setup-e2e.ts`,
  `ctx.jobs.drain()` in `test-app.ts`.

**Batch 2 — admin surface**
- Permissions `job:read`, `job:manage` (ADMIN only; `rbac.md` note incl. the `@Public()`
  token exception).
- `GET /v1/admin/jobs` (`jobList`), `GET /v1/admin/jobs/{id}` (`jobGet`),
  `POST /v1/admin/jobs/{id}/requeue` (`jobRequeue`), `POST /v1/admin/jobs/run-due`
  (`jobRunDueAdmin`); `GET /v1/admin/summary` gained `deadJobs`.

**Batch 3 — email on the queue**
- Handlers `email.verification-code`, `email.password-reset` (`AuthEmailJobs`,
  `src/modules/auth/jobs/`) and `email.account-setup` (`InvitationService`, now the handler
  body; `sendBestEffort` removed). Payload is `{ userId }` only; handlers mint the
  code/token at send time and no-op when stale (verified user, non-`INVITED` clinician).
- `signup` (user + job in one transaction), `resend-verification`, `forgot-password`,
  clinician create / update (email change) / resend all enqueue and kick after commit.
  Status codes are unchanged. The X-3 enumeration oracle is gone.

**Batch 4 — stale media (B-8)**
- `MediaJobs` (`src/modules/media/jobs/`): handler + recurring registration for
  `media.expire-stale-pending` (hourly `dedupeKey`); `MEDIA_PENDING_TTL_HOURS` (24).

**Deviations from the plan text (all small; flagging for review)**
1. **Signup re-claim bypasses the one-minute dedupe.** Row 9 keys verification emails by
   minute bucket, but a signup that *replaces credentials of an unverified account* (plan
   0009 B-1) must kill earlier codes immediately. The existing B-1 e2e test caught the
   conflict (a same-minute re-signup would have collapsed into the first job and left the
   old code valid). Fix: `enqueueVerificationCode(tx, id, { replaceOutstanding: true })`
   consumes outstanding codes in the same transaction and uses a fresh key.
2. **Clinician email change revokes the old setup link in the update transaction**
   (`revokeAccountSetup(id, tx)`), instead of when the queued send eventually runs.
3. **Password-reset jobs use the same minute-bucket key** as verification codes (the plan
   listed keys for verification, account-setup and media only).
4. **Plan §3 row 3 SQL uses snake_case column names** (`locked_at`, `run_at`); §4's schema
   (no `@map`) and every other table here are camelCase, so the raw SQL quotes camelCase
   columns. Timestamps in raw SQL are bound as UTC (`$iso::timestamp`), never `now()`.
5. **Both run-due routes were built** (admin `jobRunDueAdmin` and machine `jobRunDue`), so
   `docs.e2e-spec.ts` has five new `EXPECTED` rows, not four.
6. **`@nestjs/schedule` is pinned to `6.1.3`**: v12 (what `npm i` resolves) is ESM-only and
   cannot be loaded by the CommonJS Nest build / Jest. It pulls in `cron@4.4.0`, which
   `JobSweepService` imports directly (dynamic cron expression from `JOBS_SWEEP_CRON`).
7. **5.1 (re-armed timer) not built** — optional per the plan.

**Migration** (apply with `npm run prisma:deploy`): `20261004111128_add_jobs` — additive
(new table + enum). Authored with `prisma migrate dev` against the local throwaway test
database, not the Neon dev DB; not applied to any shared DB.

**New dependency:** `@nestjs/schedule@6.1.3`.

**New env vars** (all optional, documented in `.env.example`): `JOBS_ENABLED`,
`JOBS_SWEEP_CRON`, `JOBS_VISIBILITY_TIMEOUT_SEC`, `JOBS_BATCH_SIZE`,
`JOBS_BACKOFF_BASE_SEC`, `JOBS_BACKOFF_CAP_SEC`, `JOBS_MAX_ATTEMPTS`,
`JOBS_SUCCEEDED_RETENTION_DAYS`, `JOBS_SHUTDOWN_GRACE_SEC`, `JOBS_KICK_MODE`,
`JOBS_RUN_TOKEN`, `MEDIA_PENDING_TTL_HOURS`.

**Contract notes for the frontend**
- `GET /v1/admin/summary` gained `deadJobs` (additive).
- New admin routes under `/v1/admin/jobs`. Sending is now asynchronous: right after
  `POST /v1/clinicians` / `…/resend-invitation` the mail may not have been sent yet when the
  response is returned, so `invitationSentAt` on the create response can be `null` (it is
  set once the job runs; `GET /v1/clinicians/{id}` reflects it).
- A media ticket left `PENDING` for 24 h becomes `FAILED`; the parent must request a new ticket.

**Notes**
- Boot catch-up was verified locally (built app, local Postgres). Deploy-time verification
  on Render and Hostinger is still outstanding (§7 step 5.2).
- Shutdown release is covered by calling `releaseHeld()` in e2e and by a unit test of
  `onModuleDestroy`; an actual SIGTERM was not exercised (Windows dev machine). On Nest's
  shutdown order, `onModuleDestroy` may run after Prisma disconnects; the handler is wrapped
  in try/catch and the 5-minute visibility timeout recovers the rows if so.
- DB-default timestamps (`runAt` when a test inserts via Prisma) use the database clock,
  which drifted ~1 s ahead of the host in local Docker and made a test flaky; tests now set
  `runAt` explicitly (see `docs/testing.md`).

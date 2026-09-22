# Schema Decisions (ADR)

Source of truth: `prisma/schema.prisma`. PostgreSQL 16, all tables `@@map`-ed to `snake_case`, all primary keys UUIDv4 (`@db.Uuid`).

This document serves as the **Architecture Decision Record (ADR)** explaining the *why* behind individual tables, columns, constraints, and cryptographic choices.

> [!NOTE]
> For general database normalization rules, JSONB conventions, Docker Compose containerization, and Prisma migration workflows (`migrate dev` vs `deploy`), see [`database-and-docker.md`](database-and-docker.md).

---

## Enums

| Enum | Values | Notes |
|------|--------|-------|
| `Role` | `PARENT`, `CLINICIAN`, `ADMIN` | New users are always `PARENT`. `CLINICIAN` / `ADMIN` are assigned out-of-band (seed, later admin tooling). |
| `UserStatus` | `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `INVITED` | Only `ACTIVE` may authenticate. `SUSPENDED` is admin-driven (later phase); `DEACTIVATED` is user-driven self-exclusion; `INVITED` is a provisioned account (clinician approved by an admin) that cannot log in until its owner completes account setup. |
| `ClinicianApplicationStatus` | `PENDING`, `REVIEWED`, `APPROVED`, `REJECTED` | Lead lifecycle for the clinician-interest form. `PENDING`/`REVIEWED` are open; `APPROVED`/`REJECTED` are terminal — the admin review flow (Phase 3) moves rows to the terminal states. |
| `VerificationTokenType` | `EMAIL_VERIFICATION`, `PASSWORD_RESET`, `ACCOUNT_SETUP` | Discriminator on the single verification-token table. `ACCOUNT_SETUP` shares the `PASSWORD_RESET` shape (opaque 32-byte token, link-delivered). |
| `VerificationChannel` | `EMAIL` | Present now so adding `SMS` / `AUTHENTICATOR` later is a value, not a migration of shape. |
| `MediaType` | `PHOTO`, `VIDEO` | What kind of asset a `Media` row is. |
| `MediaStatus` | `PENDING`, `UPLOADED`, `FAILED` | `PENDING` on ticket creation; `confirm` moves it to a terminal state — see `Media` below. |
| `MediaProvider` | `CLOUDINARY` | Single value today — the column exists so a second storage backend (e.g. S3) is a value, not a migration, per the provider-agnostic `MediaStorageService` abstraction (`src/common/media-storage/`). |
| `PlanTemplateStatus` | `DRAFT`, `PUBLISHED`, `ARCHIVED` | `DRAFT` while admin is authoring days; `PUBLISHED` is a one-way gate — only a `PUBLISHED` template can be assigned to a child; `ARCHIVED` is a future "retire this template" state, not yet reachable via any endpoint this phase. |
| `PlanStatus` | `ACTIVE`, `COMPLETED`, `ARCHIVED` | At most one `ACTIVE` `Plan` per child, enforced in the service (no partial unique index — see `Plan` below). `COMPLETED`/`ARCHIVED` are both terminal; transitioning between them is `409 PLAN_ALREADY_FINAL`. |
| `PlanOrigin` | `MANUAL`, `AI` | Always `MANUAL` this milestone — the column exists so a future AI-generated-plan pipeline is a value, not a migration. No `AI`-origin code path exists yet. |

## `PlanTemplate` / `PlanTemplateDay` (`plan_templates` / `plan_template_days`) — Phase 6

Admin-owned reusable coaching content library. A template's days are authored **nested,
in one request** (`POST /v1/plan-templates` with a `days[]` body) — editing days after
creation is out of scope this phase; a `DRAFT` template with wrong content is deleted
and recreated, not patched. No template versioning: publishing is a one-way gate, and a
`PUBLISHED` template's days can never change through this API.

`PlanTemplate`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `title` | string | |
| `description` | string? | |
| `status` | `PlanTemplateStatus` default `DRAFT` | |
| `createdById` | uuid FK → `User` | `onDelete: Restrict` — same audit-trail reasoning as every other `Restrict` FK in this domain (`ClinicianChildAssignment.assignedByAdminId`, `Media.uploadedById`). |
| `createdAt` / `updatedAt` | DateTime | |

`PlanTemplateDay`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `planTemplateId` | uuid FK → `PlanTemplate` | `onDelete: Cascade` — a day has no meaning outside its template. |
| `dayNumber` | int | Caller-supplied, validated as a contiguous `1..N` set at create time (service-level, not DB-level). |
| `title` | string | |
| `instructions` | string (text) | |

Constraint: `@@unique([planTemplateId, dayNumber])`.

**Intentionally not modeled yet:** no partial-unique-index enforcement of the
`1..N`-contiguous invariant (service-layer only, same deliberate-simplification
reasoning as everywhere else in this domain), no day edit/delete endpoints, no template
deletion flow (hence `Plan.planTemplateId`'s `Restrict` FK below).

## `Plan` (`plans`) — Phase 6

A `PlanTemplate` assigned to a specific child, tracking its lifecycle. "At most one
`ACTIVE` `Plan` per child" is a **service-layer invariant only** — checked on create
(`409 PLAN_ALREADY_ACTIVE` if one already exists), not a partial unique index, per the
same deliberate-simplification call as `ClinicianChildAssignment`'s "no unassign"
decision.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `childId` | uuid FK → `Child` | `onDelete: Cascade`. |
| `planTemplateId` | uuid FK → `PlanTemplate` | `onDelete: Restrict` — no template-deletion flow exists; a template with plans referencing it must not disappear out from under them. |
| `status` | `PlanStatus` default `ACTIVE` | `ACTIVE` → `COMPLETED`/`ARCHIVED` via action endpoints (`POST /v1/plans/{id}/complete`, `.../archive`), both idempotent in their own target state, `409 PLAN_ALREADY_FINAL` transitioning between the two terminal states. |
| `origin` | `PlanOrigin` default `MANUAL` | See enum note above. |
| `startDate` | `Date` (`@db.Date`) | Anchors the "Today's Focus" day-offset computation — `dayNumber = floor((today - startDate) / 1 day) + 1`, UTC date-only arithmetic, no per-child timezone support this phase. |
| `createdById` | uuid FK → `User` | `onDelete: Restrict`, same audit-trail reasoning as above. |
| `createdAt` / `updatedAt` | DateTime | |

Index: `@@index([childId])` — every "this child's plans" lookup (assignment-invariant
check, Today's Focus) is by `childId`.

**Intentionally not modeled yet:** no plan deletion, no general plan-history list
endpoint (only "today's focus" is scoped this phase), no weekly/monthly
goal-tracking/achievement/reporting tables (flagged out-of-scope in
[plan 0006](plans/0006-phase-6-plan-domain.md) §1).

## `PlanNote` (`plan_notes`) — Phase 6

Append-only clinician-to-clinician coordination thread on a `Plan` — "what other
clinicians suggested," not a parent-facing feature. Readable by an assigned
`CLINICIAN` and `ADMIN` only, **not** `PARENT` (a real, non-obvious scoping choice —
see `docs/rbac.md`'s decision notes). No edit/delete (matches the "working paper"
framing); no notification/email when a note is left.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `planId` | uuid FK → `Plan` | `onDelete: Cascade`. |
| `authorId` | uuid FK → `User` | `onDelete: Restrict`, same audit-trail reasoning as above. |
| `note` | string (text) | |
| `createdAt` | DateTime | List endpoint sorts `(createdAt asc, id asc)` — oldest-first, unlike every other list in this codebase, because a thread reads chronologically. |

Index: `@@index([planId])` — every "this plan's notes" list query is by `planId`.

## `MonthlyCallLog` (`monthly_call_logs`) — Phase 7

Records that a clinician made their monthly check-in call with a child's parent — the
fact that a call happened, not a scheduling/reminder system for when the next one is
due (out of scope this phase, see [plan 0007](plans/0007-phase-7-monthly-call-log.md)
§2). Append-only, same "working paper" framing as `PlanNote` — no edit/delete. Readable
by an assigned `CLINICIAN` and `ADMIN` only, **not** `PARENT` — same non-obvious
scoping shape as `PlanNote`, see `docs/rbac.md`'s decision notes.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `childId` | uuid FK → `Child` | `onDelete: Cascade`. |
| `clinicianId` | uuid FK → `User` | The clinician who logged the call. `onDelete: Restrict`, same audit-trail reasoning as every other "who did this" FK in this domain (`Media.uploadedById`, `Plan.createdById`, `PlanNote.authorId`). |
| `calledAt` | `DateTime` (full timestamp, not `@db.Date`) | Unlike `Child.dateOfBirth` / `Plan.startDate`, a phone call happens at a specific moment — the time component is worth keeping. No validation that it isn't in the future — a deliberate simplification. |
| `notes` | string? | Optional free-text caller-supplied note about the call. |
| `createdAt` | DateTime | |

Index: `@@index([childId])` — the list-call-history query is by `childId`, sorted
`(calledAt desc, id desc)` — newest-first, matching every other list in this codebase
except `PlanNote`'s (see above).

**Intentionally not modeled yet:** no single-log-by-id `GET` (only the child's full
call history list is an MVP screen), no edit/delete, no reminder/scheduling table for
when the next call is due.

## `User` (`users`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `email` | string, **unique** | Normalised `.toLowerCase().trim()` before every write/lookup. The unique index is the enumeration guard — signup on an existing verified email returns 409 without confirming which. |
| `passwordHash` | string? | argon2id. Never selected into any response DTO. **Nullable** since Phase 3: an `INVITED` clinician has no password until account setup completes — a genuine absence, not a placeholder. Only `ACTIVE` users authenticate, and login/refresh never run for `INVITED`, so no code path reads a null hash. |
| `name` | string | |
| `role` | `Role` default `PARENT` | |
| `status` | `UserStatus` default `ACTIVE` | |
| `emailVerifiedAt` | DateTime? | Null until the 6-digit code is accepted. Login requires non-null. |
| `lastLoginAt` | DateTime? | Set on every successful login. |
| `selfExcludedAt` | DateTime? | Set alongside `status = DEACTIVATED`. Kept distinct from `updatedAt` so "when did the user choose to leave" survives later profile edits. |
| `createdAt` / `updatedAt` | DateTime | `@default(now())` / `@updatedAt` |

Relations: `refreshTokens[]`, `verificationTokens[]`, both `onDelete: Cascade`.

## `RefreshToken` (`refresh_tokens`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `userId` | uuid FK → `User` (cascade) | |
| `tokenHash` | string, **unique** | SHA-256 hex of the opaque 32-byte token. The plaintext is returned to the client once and never stored. |
| `expiresAt` | DateTime | `REFRESH_TOKEN_TTL_DAYS` from issue. |
| `revokedAt` | DateTime? | Set on rotation, logout, password reset, or deactivation. |
| `createdAt` | DateTime | |

Index: `@@index([userId])` — every revoke-all and cleanup query is by user.

**Why opaque, not a JWT:** a refresh token must be individually revocable and its reuse
must be detectable. A stateless JWT is neither without a denylist, at which point it is
just a worse version of a table. Rotation on every `/auth/refresh` plus "reuse of a
revoked token revokes the entire family" gives theft detection for free. Only the hash
is stored, so a database leak does not yield usable tokens.

## `VerificationToken` (`verification_tokens`)

One table backs **both** email verification (D4) and password reset (D5).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `userId` | uuid FK → `User` (cascade) | |
| `type` | `VerificationTokenType` | `EMAIL_VERIFICATION` or `PASSWORD_RESET`. |
| `channel` | `VerificationChannel` default `EMAIL` | |
| `tokenHash` | string | SHA-256 hex. For `EMAIL_VERIFICATION` it hashes a 6-digit numeric code; for `PASSWORD_RESET` / `ACCOUNT_SETUP` an opaque 32-byte token. |
| `attempts` | int default `0` | Incremented on each wrong `EMAIL_VERIFICATION` guess; the token is consumed once `EMAIL_VERIFICATION_MAX_ATTEMPTS` is hit. |
| `expiresAt` | DateTime | 10 min for email codes, 60 min for reset tokens, 60 min for account-setup tokens (all env-configurable — `EMAIL_VERIFICATION_TTL_MIN`, `PASSWORD_RESET_TTL_MIN`, `ACCOUNT_SETUP_TTL_MIN`). |
| `consumedAt` | DateTime? | Single-use. Issuing a new token of a type first consumes any outstanding ones for that user+type. |
| `createdAt` | DateTime | `verifyEmailCode` picks the newest unconsumed, unexpired row. |

Indexes: `@@index([userId, type])` (issue / verify lookups), `@@index([tokenHash])`
(reset-link resolution, which has no user context).

**Why one table:** email verification, password reset, and account setup are the same
primitive — a hashed, expiring, single-use secret tied to a user, delivered over a
channel. Modelling them separately would duplicate the TTL/consume/attempt logic.
`ACCOUNT_SETUP` was added in Phase 3 as a third `type` value with **no schema change** —
exactly the extensibility this shape was built for. The `type` + `channel` columns make
the table extensible to MFA enrolment or login step-up later with **no schema rewrite**.

## `ClinicianApplication` (`clinician_applications`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `name` | string | |
| `email` | string | Normalised, but **not** unique — a lead is not an account. On approve, a `User` with this email is provisioned (or the approve 409s if one already exists). |
| `context` | string (text) | Free-text background / reason for applying. |
| `status` | `ClinicianApplicationStatus` default `PENDING` | |
| `reviewNote` | string? | Optional free-text reason captured on **reject** (Phase 3). Null on approve and while pending. |
| `createdAt` / `updatedAt` | DateTime | |

Index: `@@index([status])` — the (later) admin review queue filters by status.

**Naming note (D22):** the Nest module was renamed `clinician-applications` →
`clinicians`, its first feature slice is `features/submit-application/`
(`SubmitApplicationController` / `SubmitApplicationService`), and the route's
operationId is `clinicianApplicationSubmit`. The **Prisma model name stays
`ClinicianApplication`** — it is the lead record, and "application" is the right word
for the row. The HTTP route path also stays `POST /v1/clinician-applications` (public
landing-page contract). No deviation from the plan's default was taken.

## `Child` (`children`) — Phase 4

The central Core Care Domain subject. A child never authenticates — no `email`,
`passwordHash`, or auth fields on this table.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `parentId` | uuid FK → `User`, **unique** | DB-enforces the locked business rule "exactly one child per parent" from the child side — a parent cannot own a second `Child` row. `onDelete: Cascade`. |
| `name` | string | |
| `dateOfBirth` | `Date` (`@db.Date`, no time component) | A birthdate has no meaningful time-of-day. |
| `createdAt` / `updatedAt` | DateTime | |

## `ClinicianChildAssignment` (`clinician_child_assignments`) — Phase 4

Many-to-many join between `User` (`role = CLINICIAN`) and `Child`. This single table
is what makes "a child may have multiple clinicians" and "a clinician may work across
multiple children" real, and it's the join every clinician-side ownership check
(media, plans, call logs, in later phases) will walk through.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `clinicianId` | uuid FK → `User` | `onDelete: Cascade` — no orphaned assignment rows if a clinician account is removed. |
| `childId` | uuid FK → `Child` | `onDelete: Cascade`. |
| `assignedByAdminId` | uuid FK → `User` | Audit-only — which admin made the assignment. `onDelete: Restrict`: no admin-deletion flow exists yet, and silently cascading an audit trail away if one is added later would be the wrong default. |
| `createdAt` | DateTime | |

Constraints: `@@unique([clinicianId, childId])` — the same clinician cannot be
assigned to the same child twice (re-assigning is a `409 CLINICIAN_ALREADY_ASSIGNED`,
not a silent no-op). `@@index([childId])` — every "who is assigned to this child"
lookup (ownership checks, future assignment listings) is by `childId`.

**Intentionally not modeled yet:** no unassign/removal support on the join (no MVP
screen needs it yet). No partial-unique-index enforcement beyond what's stated above.

## `Media` (`media`) — Phase 5

A photo/video a parent captures of their child. The backend never touches the binary —
the client uploads directly to the storage provider (Cloudinary today) using a signed
ticket this backend mints; this row is the durable record of that upload's lifecycle.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | Also used as the Cloudinary `public_id` — minted before the upload ticket, so the client's direct-to-provider upload and this row share an id from the start. |
| `childId` | uuid FK → `Child` | `onDelete: Cascade`. |
| `uploadedById` | uuid FK → `User` | The parent who created the upload ticket. `onDelete: Restrict` — same audit-trail reasoning as `ClinicianChildAssignment.assignedByAdminId` (Phase 4): no user-deletion flow exists yet. |
| `type` | `MediaType` | `PHOTO` or `VIDEO`, set at ticket creation — determines the Cloudinary `resource_type` used for both the signed upload and the later `verifyUpload` lookup. |
| `provider` | `MediaProvider` default `CLOUDINARY` | See enum note above. |
| `storageKey` | string | Opaque provider-shaped key (`MediaStorageService.createUploadTicket`'s return value) — the **only** storage detail this table ever stores. No Cloudinary-specific columns (no `publicId`/`folder`/`version` fields) — swapping providers later changes what's packed into this one string, not the schema. |
| `status` | `MediaStatus` default `PENDING` | `PENDING` → `UPLOADED`/`FAILED` via `POST /v1/media/{id}/confirm`, which is a terminal transition (re-confirming the same terminal status is a no-op; a conflicting one is `409`). |
| `mimeType` / `durationSeconds` / `sizeBytes` | string? / int? / int? | Client-self-reported at `confirm` time, only trusted once `MediaStorageService.verifyUpload` confirms the asset actually landed. Null while `PENDING` or on a `FAILED` confirm. |
| `context` | string? | Optional free-text caller-supplied note (e.g. what the clip is of) — not interpreted by this backend. |
| `createdAt` / `updatedAt` | DateTime | |

Index: `@@index([childId])` — every "this child's media gallery" list query
(`GET /v1/children/{childId}/media`) is by `childId`.

**Intentionally not modeled yet:** no thumbnail/transformation metadata beyond what
Cloudinary does by default, no soft-delete/deletion support (no MVP screen needs it
yet), no document/file-type registry beyond photo/video, no AI-pipeline persistence
(`AIModelRun`/`Embedding`/etc — that's a later, not-yet-scoped phase).

## Migrations

`prisma/migrations/**` is generated by `npm run prisma:migrate` and committed. E2E
`global-setup.ts` runs `prisma migrate deploy` against `TEST_DATABASE_URL`.

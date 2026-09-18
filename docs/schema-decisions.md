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

## Migrations

`prisma/migrations/**` is generated by `npm run prisma:migrate` and committed. E2E
`global-setup.ts` runs `prisma migrate deploy` against `TEST_DATABASE_URL`.

# Plan 0003 — Phase 3: Clinician Application Review (Admin)

Status: **Active**
Owner: backend
Last updated: 2026-09-01

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code.

---

## 1. Context

Phase 1 (plan [0001](0001-phase-1-auth-onboarding.md)) shipped auth + onboarding. Phase 2
(plan [0002](0002-phase-2-standards-hardening.md), code-complete) added the reflection-based
RBAC coverage test, the RFC 9457 error envelope, [api-conventions.md](../api-conventions.md),
and *decided* cursor pagination without implementing it.

An admin currently has no way to act on the `ClinicianApplication` leads captured by the
public `POST /v1/clinician-applications` form. This phase adds the admin review loop:
**list / view / approve / reject**. On **approve** it provisions a real `CLINICIAN`
`User` that cannot authenticate until its owner sets a password via an emailed link — an
`ACCOUNT_SETUP` verification token, the same primitive as password reset. It also builds
the first concrete cursor-pagination implementation, matching the shape already fixed in
[api-conventions.md](../api-conventions.md).

**Out of scope — must not be scaffolded** (Phase 4, design-only, not started):
certificate / document upload, the richer multi-step clinician application, any `Child`
record, background-job infrastructure. No Phase 3 logic depends on them — approve
provisions only an auth-anchor `User` row, not a profile — so nothing here reaches for
file handling, a queue, or a `Child` relation. No admin-panel UI (separate round). No
applicant-facing status check (still deferred, as documented).

## 2. Scope

**In:**

- Schema: `UserStatus.INVITED`, `VerificationTokenType.ACCOUNT_SETUP`,
  `User.passwordHash` nullable, `ClinicianApplication.reviewNote` nullable. One migration.
- `ACCOUNT_SETUP_TTL_MIN` env var (default 60).
- `VerificationTokenService` gains `issueAccountSetupToken` / `consumeAccountSetupToken`.
- New shared infra `src/common/pagination/` (cursor query DTO + encode/decode + helper).
- New auth feature `complete-account-setup` (public).
- New `clinicians` features: `list-applications`, `get-application`,
  `approve-application`, `reject-application` — all `ADMIN`-gated.
- `EmailService.sendAccountSetupLink` + Resend impl + template + fake.
- Tests alongside every slice; `test/docs.e2e-spec.ts` `EXPECTED` kept in sync; admin
  review flow added to `test/clinician-application.e2e-spec.ts`.
- Doc updates: `schema-decisions.md`, `auth-flows.md`, `api-conventions.md`, `AGENTS.md`.

**Out:** anything in §1's out-of-scope list. No `permissions.ts` change (the two
permissions already exist and are `ADMIN`-granted). No new module (`clinicians` absorbs
the admin routes). No `SUSPENDED`-flow work. No applicant status endpoint.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Repeated **same** action on a terminal state is an idempotent no-op | From `PENDING`/`REVIEWED`, approve/reject proceed. From a terminal state: same action → return current state, **no** new user/token/email; opposite action → `409 APPLICATION_DECISION_FINAL`. `REVIEWED` = still-open. Protects `approve` (real side effects) from a double-click / retry. |
| 2 | `ClinicianApplication.reviewNote` added; `reject` takes optional `{ reason }` | Product chose "add optional note". Nullable column; stored trimmed on reject; left null on approve. Addition on top of the brief. |
| 3 | New error codes | `APPLICATION_DECISION_FINAL` (409), `APPLICATION_NOT_FOUND` (404), `INVALID_SETUP_TOKEN` (400), `INVALID_CURSOR` (400). Approve-onto-existing-email reuses `EMAIL_ALREADY_REGISTERED` (409) and leaves application status unchanged. |
| 4 | Cursor pagination implemented now in `src/common/pagination/` | Phase 2 deferred only the implementation; shape (`{ data, nextCursor }`, `?cursor=&limit=`) is fixed in api-conventions.md. `limit` default 20, hard cap 100. Cursor = opaque base64url over the row `id`; sort `(createdAt desc, id desc)`; Prisma native `cursor` + `skip: 1` + `take: limit + 1`. |
| 5 | Admin review endpoints live in `CliniciansModule` | Same resource collection / route prefix as `submit-application`. No `admin` module. |
| 6 | `AuthModule` exports `VerificationTokenService` | So `CliniciansModule` (which will `imports: [AuthModule]`) can issue `ACCOUNT_SETUP` tokens. Mirrors `UsersModule` importing `AuthModule` for `RefreshTokenService`. |
| 7 | `approve` wraps `user.create` + `application.update` in one `prisma.$transaction` | Token issue + email dispatch happen after the tx. First transaction in the codebase; justified by the two-entity write. |
| 8 | `complete-account-setup` does not revoke sessions | Unlike `reset-password` — an `INVITED` user has none. |
| 9 | operationIds `clinicianApplicationList` / `...Get` / `...Approve` / `...Reject` | Mirror the existing `clinicianApplicationSubmit`. Actions return `200 OK` + body. |
| 10 | e2e extends `test/clinician-application.e2e-spec.ts` | No 5th suite file; a local admin-user seed helper is added in the spec. |
| 11 | Only `ACTIVE` authenticates — no guard change for `INVITED` | `JwtAuthGuard` and `LoginService` already gate on `status !== ACTIVE → 403 ACCOUNT_NOT_ACTIVE`. |

## 4. Data model

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
  DEACTIVATED
  INVITED        // provisioned account, cannot authenticate until account-setup completes
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  ACCOUNT_SETUP  // opaque 32-byte token, SHA-256 at rest, single-use, TTL ACCOUNT_SETUP_TTL_MIN
}

model User {
  // passwordHash String  ->  String?   genuinely absent until account-setup completes
  passwordHash String?
  // ...unchanged
}

model ClinicianApplication {
  reviewNote String?   // optional free-text rejection reason; null on approve
  // ...unchanged (name, email, context, status, createdAt, updatedAt, @@index([status]))
}
```

One migration, `phase_3_clinician_review`. `prisma/seed.ts` already writes a non-null
`passwordHash`, so nullability is backward-compatible. `truncateAll()` in
`prisma.service.ts` already lists every table.

## 5. Endpoints

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `GET` | `/v1/clinician-applications` | `clinicianApplicationList` | `@Auth('clinician-application:list')` | `?cursor=&limit=` + `?status=`; body `{ data: ClinicianApplicationDto[], nextCursor: string \| null }` |
| `GET` | `/v1/clinician-applications/{id}` | `clinicianApplicationGet` | `@Auth('clinician-application:list')` | `id` via `ParseUUIDPipe`; `404 APPLICATION_NOT_FOUND` |
| `POST` | `/v1/clinician-applications/{id}/approve` | `clinicianApplicationApprove` | `@Auth('clinician-application:review')` | `200` `{ application: ClinicianApplicationDto, clinicianUserId: string \| null }` |
| `POST` | `/v1/clinician-applications/{id}/reject` | `clinicianApplicationReject` | `@Auth('clinician-application:review')` | `200` `{ application: ClinicianApplicationDto }`; body `{ reason?: string }` |
| `POST` | `/v1/auth/complete-account-setup` | `authCompleteAccountSetup` | `@Public()` + `@AuthThrottle()` | `200` `{ complete: true }`; body `{ token, password }`; `400 INVALID_SETUP_TOKEN` |

Shared response DTO: `ClinicianApplicationDto` in `src/modules/clinicians/shared/`
(`id, name, email, context, status, reviewNote, createdAt, updatedAt`).

### approve service logic

1. Load app → `404 APPLICATION_NOT_FOUND`.
2. `REJECTED` → `409 APPLICATION_DECISION_FINAL`.
3. `APPROVED` → no-op: return `{ application, clinicianUserId: <user by app.email>?.id ?? null }`.
4. Normalise `app.email`; existing `User` with it → `409 EMAIL_ALREADY_REGISTERED`,
   status untouched.
5. `$transaction`: create `User { email, name: app.name, role: CLINICIAN,
   status: INVITED, passwordHash: null, emailVerifiedAt: null }`; update app
   `status = APPROVED`.
6. After tx: `token = issueAccountSetupToken(user.id)`; `setupUrl =
   ${appWebUrl}/complete-account-setup?token=<enc>`; `sendAccountSetupLink(user.email, setupUrl)`.

### reject service logic

`404` if missing; `APPROVED` → `409 APPLICATION_DECISION_FINAL`; `REJECTED` → no-op
return (keep existing `reviewNote`); else update `status = REJECTED,
reviewNote = dto.reason?.trim() ?? null`.

### complete-account-setup logic (mirrors reset-password)

`userId = consumeAccountSetupToken(dto.token)`; null → `400 INVALID_SETUP_TOKEN`. Else
`passwordHash = passwords.hash(dto.password)`; `user.update { passwordHash,
status: ACTIVE, emailVerifiedAt: now() }`. Return `{ complete: true }`.

## 6. Cross-cutting

- **Config** — `ACCOUNT_SETUP_TTL_MIN` in `env.validation.ts`
  (`Joi.number().integer().positive().default(60)`), `configuration.ts`
  (`verification.accountSetupTtlMin`), `.env.example` (next to `PASSWORD_RESET_TTL_MIN`).
- **Tokens** — `VerificationTokenService.issueAccountSetupToken` /
  `consumeAccountSetupToken` mirror the `PASSWORD_RESET` pair exactly (reuse
  `generateOpaqueToken`, `sha256` from `@common/crypto/token.util`). New
  `verification-token.service.spec.ts` (none exists today).
- **Pagination** — `src/common/pagination/`: `cursor-pagination.query.dto.ts`
  (`cursor?`, `limit?` `@IsInt @Min(1) @Max(100)`), `cursor.util.ts`
  (`encodeCursor` / `decodeCursor` → `400 INVALID_CURSOR`; `paginate()` helper).
- **Email** — `EmailService` abstract gains `sendAccountSetupLink`; `ResendEmailService`
  implements via new `templates/account-setup.template.ts`; `FakeEmailService` records
  it (`lastSetupUrlFor`, `SentEmail.kind` union extended).
- **Authz** — no `permissions.ts` / `ROLE_PERMISSIONS` change. New `@Auth(...)` routes
  are auto-covered by `rbac-route-coverage.e2e-spec.ts`. No decision note in `rbac.md`
  needed (admin-only, unconditional, guard fully enforces — no service-side scope).
- **OpenAPI** — every new handler gets one `@ApiOperation({ operationId })`, explicit
  `@HttpCode` where not 200/201, `@ApiOkResponse` / `@ApiCreatedResponse` typed DTO.
  `test/docs.e2e-spec.ts` `EXPECTED` updated in the same slice (paths use `{id}`).
- **Module wiring** — `AuthModule` exports `VerificationTokenService` + registers the
  `complete-account-setup` controller/service. `CliniciansModule` `imports: [AuthModule]`
  and registers the four new controllers/services.

## 7. Build order (ordered checklist)

- [x] **0. Plan doc** — this file + `docs/plans/README.md` row; flip 0002 → Done.
- [x] **1. Schema + config + token service** — `schema.prisma` + migration
  `20260901162705_phase_3_clinician_review`; `ACCOUNT_SETUP_TTL_MIN` in the three config
  files; `issueAccountSetupToken` / `consumeAccountSetupToken` + ctor TTL + doc comment;
  `verification-token.service.spec.ts`; `login.service.ts` null-hash guard (passwordHash
  now nullable); `schema-decisions.md`. Verified: lint + `npm test` (34) +
  `npm run test:e2e` (31) green.
- [x] **2. `POST /v1/auth/complete-account-setup`** — `EmailService.sendAccountSetupLink`
  + Resend impl + `account-setup.template.ts` + `FakeEmailService`
  (`lastSetupUrlFor`); feature folder (dto, controller `@Public`+`@AuthThrottle`+
  `@HttpCode(200)`, service, spec); `AuthModule` wired + now exports
  `VerificationTokenService`; `docs.e2e-spec.ts` `EXPECTED` row; `auth-flows.md`.
  Verified: lint + `npm test` (36) + `npm run test:e2e` (32) green. Runtime curl smoke
  folded into slice 5's end-to-end.
- [x] **3. Pagination infra** — `src/common/pagination/`: `cursor-pagination.query.dto.ts`
  (`cursor?`, `limit?`, `DEFAULT_PAGE_LIMIT=20`, `MAX_PAGE_LIMIT=100`), `cursor.util.ts`
  (`encodeCursor`/`decodeCursor` → `400 INVALID_CURSOR`, `toCursorPage`),
  `cursor.util.spec.ts` (6). Verified: `npx jest src/common/pagination` green.
- [x] **4. `GET` list + `GET /{id}`** — `shared/clinician-application.dto.ts`
  (`ClinicianApplicationDto.from`); `list-applications/` (query dto `extends`
  `CursorPaginationQueryDto` + `status?`, response dto, controller, service, spec — 4);
  `get-application/` (controller `@Get(':id')` + `ParseUUIDPipe`, service, spec — 2);
  registered in `CliniciansModule`; two `EXPECTED` rows (`{id}` form).
  Verified: lint + `npm test` (48) + `npm run test:e2e` (34) green.
- [x] **5. `POST /{id}/approve` + `POST /{id}/reject`** — `AuthModule` exports
  `VerificationTokenService` (done in slice 2); `CliniciansModule imports [AuthModule]`;
  `approve-application/` (response dto, controller `@HttpCode(200)` + `ParseUUIDPipe`,
  service, spec — 6: happy path, 404, `DECISION_FINAL` from REJECTED, no-op from
  APPROVED, `EMAIL_ALREADY_REGISTERED` w/ status untouched); `reject-application/`
  (dto `{ reason? }` + response, controller, service, spec — 6); two `EXPECTED` rows;
  admin review flow added to `test/clinician-application.e2e-spec.ts` (seed ADMIN via
  `PasswordService`, login, 401/403, pagination + `?status=` + `INVALID_CURSOR`,
  get/404/400, approve→invited→setup→login, idempotent re-approve with no 2nd email,
  reject w/ reason + idempotency, cross-transition 409s, email-clash 409).
  `approve` uses `$transaction([...])` (array form — atomic, no data flow between the
  two writes). Verified: lint + `npm run build` + `npm test` (58) +
  `npm run test:e2e` (43) all green.
- [x] **6. Docs sync** — `api-conventions.md` (approve/reject action-path note,
  `APPLICATION_DECISION_FINAL` / `INVALID_CURSOR` / `INVALID_SETUP_TOKEN` in the
  status-code table, pagination implementation note); `AGENTS.md` (`VerificationToken`
  line + e2e-suites list); `rbac.md` (the `clinician-application:*` pair is now live,
  unconditional ADMIN-only — no decision note warranted); `docs/README.md` +
  `docs/plans/README.md` (0002→Done, 0003 Active). Verified: `npm run build` +
  `npm test` (58) + `npm run test:e2e` (43) green.

## 8. How to resume

> Phase 3 is **code-complete and pending review** — every §7 slice is checked. If
> continuing: confirm `npm run lint && npm test && npm run test:e2e` are green (needs
> local Postgres — `docker compose up -d` — and the `neuronest_test` database; the e2e
> global-setup runs `prisma migrate deploy` against `TEST_DATABASE_URL`). Migration
> `20260901162705_phase_3_clinician_review` is committed. Do not touch `permissions.ts`
> (the two permissions already exist and are ADMIN-granted). Do not scaffold document
> upload, `Child`, or a job queue (Phase 4). On approval, flip this plan and the
> `docs/plans/README.md` row to **Done**.
>
> Runtime smoke (optional, `npm run start:dev`): seed an ADMIN, `POST
> /v1/clinician-applications`, `GET /v1/clinician-applications?limit=1` (follow
> `nextCursor`), `POST .../{id}/approve` → check the `users` row is
> `CLINICIAN`/`INVITED`/`passwordHash null` and an account-setup email was logged,
> `POST /v1/auth/complete-account-setup {token,password}` → then login succeeds.

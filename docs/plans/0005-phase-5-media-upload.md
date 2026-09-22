# Plan 0005 — Phase 5: Media Upload (Cloudinary, abstracted)

Status: **Done**
Owner: backend
Last updated: 2026-09-20

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the checklist that was worked in order to ship it. All §4/§5/§6
> drafts below were implemented as written — no deviation from the drafts was needed
> after re-verifying them against `src/common/email/` and `docs/rbac.md` in step 0.

---

## 1. Context

Phase 4 (plan [0004](0004-phase-4-child-clinician-foundation.md), Done) shipped the
`Child` record and the clinician↔child assignment join — the Core Care Domain
foundation everything else hangs off. This phase adds the second piece: **media
upload** (photos/videos a parent captures of their child), which the future AI
pipeline (video → behavioral analysis) will eventually consume, though that pipeline
is explicitly not built now.

Resolved in the original Milestone A scoping round: media storage is an **abstracted
`MediaStorageService`** interface (mirrors the existing `EmailService`
abstract+Fake+Resend pattern), with the initial concrete implementation targeting
**Cloudinary** (images+video), swappable to S3/blob storage later without touching the
domain model or call sites.

**Out of scope — must not be scaffolded here:** `PlanTemplate`/`Plan`/`PlanNote`
(Phase 6), `MonthlyCallLog` (Phase 7), any AI-pipeline persistence
(`AIModelRun`/`Embedding`/etc.), any document/file-type registry beyond photo/video,
any admin/parent/clinician frontend. No behavioral-analysis processing of uploaded
media — this phase only gets bytes safely into storage and a row into Postgres.

## 2. Scope

**In:**

- Schema: `MediaType` (`PHOTO`, `VIDEO`), `MediaStatus` (`PENDING`, `UPLOADED`,
  `FAILED`), `MediaProvider` (`CLOUDINARY`) enums; `Media` model. One migration.
- `MediaStorageService` abstract class + DI token (same pattern as `EmailService`):
  `CloudinaryMediaStorageService` (production) + `FakeMediaStorageService` (tests).
- New `media` npm dependency: the official `cloudinary` SDK.
- Config: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` via
  the existing `Joi`-validated env pattern (mirrors how Resend API keys are wired).
- Permissions: `media:create:self` (PARENT only — matches the original
  architecture note's "parent app calls create-upload-ticket"), `media:read`
  (PARENT-own / CLINICIAN-assigned / ADMIN-any — same ownership-branch-in-service
  pattern as `child:read`, walked through the existing `ClinicianChildAssignment`
  join via the media row's `childId`).
- Endpoints (see §5): create an upload ticket, confirm the upload, list a child's
  media.
- Tests alongside every slice; e2e coverage for the ticket→confirm round trip and
  the same cross-parent/cross-clinician isolation shape as Phase 4's suite.
- Doc updates: `schema-decisions.md`, `rbac.md`, `database-and-docker.md` (Cloudinary
  env vars), `docs/plans/README.md`.

**Out:** actually receiving/proxying media bytes through this backend (the client
uploads directly to Cloudinary using the signed ticket — this backend never touches
the binary). No media deletion endpoint (no MVP screen needs it yet). No thumbnail/
transformation pipeline beyond whatever Cloudinary does by default. No virus/content
scanning (flag if this becomes a real requirement — out of scope for a decision made
unilaterally here).

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | Client uploads directly to Cloudinary; backend never proxies bytes | Standard large-binary-upload pattern. Backend's job is: (a) mint a signed upload ticket, (b) record a `Media` row, (c) verify + finalize after the client reports success. |
| 2 | Only `PARENT` creates media (their own child) | Matches the original architecture note exactly. Clinician/admin media *write* access (e.g. a clinician uploading during a session) is explicitly deferred — flag it as a real question if it comes up, don't silently add it here. |
| 3 | `media:read` is one permission for all three roles, ownership branches in the service | Identical shape to `child:read` (`docs/rbac.md` §6) — `PARENT` → owns the child; `CLINICIAN` → live `ClinicianChildAssignment` for the media's `childId`; `ADMIN` → unconditional. Single existence/equality check, not a compound condition — does not trigger the CASL migration note. |
| 4 | Three-step flow: create-ticket → client upload → confirm | `POST .../media/upload-tickets` creates `Media{status: PENDING}` + returns a signed ticket; `POST /v1/media/{id}/confirm` flips it to `UPLOADED` (with final `mimeType`/`sizeBytes`/`durationSeconds`) or `FAILED`. |
| 5 | `confirm` is idempotent for the **same** terminal status, a conflict for a **different** one | Mirrors Phase 3's `approve`/`reject` idempotency pattern. Re-confirming `UPLOADED` with the same data is a no-op 200; confirming `FAILED` after `UPLOADED` (or vice versa) is `409 MEDIA_ALREADY_CONFIRMED`. |
| 6 | `MediaStorageService` is provider-agnostic at the interface | `createUploadTicket({ mediaId, childId, type })` returns `{ storageKey, uploadParams: Record<string, unknown> }` — `uploadParams` is deliberately opaque/provider-shaped (Cloudinary's signature/timestamp/apiKey/folder today); the `Media` table only ever stores the opaque `storageKey` string, never Cloudinary-specific columns. |
| 7 | `GET /v1/children/{childId}/media` is the only read endpoint this phase | No single-media-by-id GET yet — no screen needs it standalone; add when one does. |
| 8 | New `media` domain module, not folded into `children` | `Media` is its own first-class table with its own storage-integration surface; matches "one module per domain." It depends on `children`'s `Child`/`ClinicianChildAssignment` tables directly via Prisma (no cross-module service import needed — no repository layer, Prisma is the data-access layer for both). |

## 4. Data model (draft — confirm before migrating)

```prisma
enum MediaType {
  PHOTO
  VIDEO
}

enum MediaStatus {
  PENDING
  UPLOADED
  FAILED
}

enum MediaProvider {
  CLOUDINARY
}

model Media {
  id               String        @id @default(uuid()) @db.Uuid
  childId          String        @db.Uuid
  child            Child         @relation(fields: [childId], references: [id], onDelete: Cascade)
  uploadedById     String        @db.Uuid
  uploadedBy       User          @relation(fields: [uploadedById], references: [id], onDelete: Restrict)
  type             MediaType
  provider         MediaProvider @default(CLOUDINARY)
  storageKey       String
  status           MediaStatus   @default(PENDING)
  mimeType         String?
  durationSeconds  Int?
  sizeBytes        Int?
  context          String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([childId])
  @@map("media")
}
```

`Child` gains `media Media[]` back-relation; `User` gains `uploadedMedia Media[]`.
`uploadedById` uses `onDelete: Restrict` (same audit-trail reasoning as Phase 4's
`assignedByAdminId` — no user-deletion flow exists yet). `@@index([childId])` — every
"this child's media gallery" list query is by `childId`.

## 5. Endpoints (draft — confirm before coding)

| Method | Path | operationId | Auth | Notes |
|--------|------|-------------|------|-------|
| `POST` | `/v1/children/{childId}/media/upload-tickets` | `mediaCreateUploadTicket` | `@Auth('media:create:self')` | Caller must be `childId`'s parent (`404 CHILD_NOT_FOUND` / `403 FORBIDDEN`, same shape as `child:read`). Body `{ type: 'PHOTO' \| 'VIDEO', context?: string }`. `201` + `{ media: MediaDto, uploadParams: Record<string, unknown> }`. |
| `POST` | `/v1/media/{id}/confirm` | `mediaConfirmUpload` | `@Auth('media:create:self')` | Caller must be the child's parent. Body `{ status: 'UPLOADED' \| 'FAILED', mimeType?, sizeBytes?, durationSeconds? }`. `200` + `MediaDto`. `404 MEDIA_NOT_FOUND`; `409 MEDIA_ALREADY_CONFIRMED` on a conflicting re-confirm; `400 MEDIA_UPLOAD_NOT_VERIFIED` if `status: UPLOADED` but `MediaStorageService.verifyUpload` finds no asset at the ticket's `storageKey`. |
| `GET` | `/v1/children/{childId}/media` | `mediaList` | `@Auth('media:read')` | Same ownership branch as `GET /v1/children/{id}`. Cursor-paginated (`src/common/pagination/`, already built in Phase 3) — `?cursor=&limit=`, sorted `(createdAt desc, id desc)`. |

Shared response DTO: `MediaDto` (`id, childId, uploadedById, type, provider, status,
mimeType, durationSeconds, sizeBytes, context, createdAt, updatedAt`) in
`src/modules/media/shared/`.

## 6. Cross-cutting (draft)

- **Config** — `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
  in `env.validation.ts` (`Joi.string().required()` in production; the `Fake` impl
  means local/test never needs real credentials), `configuration.ts`
  (`cloudinary.{cloudName,apiKey,apiSecret}`), `.env.example`.
- **`MediaStorageService`** — abstract class in `src/common/media-storage/`
  (mirrors `src/common/email/`): `createUploadTicket(...)`, `verifyUpload(...)`.
  `CloudinaryMediaStorageService` uses the `cloudinary` SDK's signed-upload-params
  helper (no network call to create a ticket — signing is local). `verifyUpload`
  calls Cloudinary's Admin API (`resources` lookup by `public_id`) to confirm the
  asset actually landed before trusting the client's self-reported `confirm` body.
  `FakeMediaStorageService` returns a deterministic stub and lets tests simulate
  both `UPLOADED` and `FAILED` outcomes.
- **Authz** — two new permissions per §3 rows 2–3; `rbac.md` decision note pointing
  back at the `child:read`-shaped precedent instead of re-explaining it.
- **Pagination** — reuses `src/common/pagination/` as-is, no changes needed there.
- **OpenAPI** — three new `EXPECTED` rows in `test/docs.e2e-spec.ts`.
- **Module wiring** — new `MediaModule`, registered in `app.module.ts`; new
  `MediaStorageModule` (or fold into an existing shared-infra registration pattern —
  confirm against how `EmailModule` is structured before deciding) providing the DI
  token, imported wherever `MediaModule` needs it.
- **`truncateAll()`** — add `media` to the table list in `prisma.service.ts`.

## 7. Build order (ordered checklist — all shipped)

- [x] **0. Confirm §4/§5/§6 drafts** — re-read them against the actual current state
  of `src/common/email/` (the pattern to mirror) and `docs/rbac.md` before writing
  any code; adjust this doc if reality has drifted since 2026-09-20. No drift found —
  drafts implemented as written.
- [x] **1. `cloudinary` dependency + config** — `npm install cloudinary`; env vars in
  `env.validation.ts` / `configuration.ts` / `.env.example`.
- [x] **2. `MediaStorageService` abstraction** — abstract class,
  `CloudinaryMediaStorageService`, `FakeMediaStorageService`, DI token, unit specs for
  the Cloudinary implementation's signing logic (no real network calls in unit tests).
  `FakeMediaStorageService` lives in `test/helpers/` (not `src/common/`), same as
  `FakeEmailService` — the real repo pattern the plan's §6 wording was mirroring.
- [x] **3. Schema + migration** — `Media` model + three enums; `Child`/`User`
  relation fields; `truncateAll()` updated; `schema-decisions.md` entry.
- [x] **4. Permissions** — `media:create:self`, `media:read`; `rbac.md` decision note.
- [x] **5. `POST /v1/children/{childId}/media/upload-tickets`** — `MediaModule`,
  `shared/media.dto.ts`, feature folder (dto, controller, service, spec); registered
  in `app.module.ts`; `docs.e2e-spec.ts` row.
- [x] **6. `POST /v1/media/{id}/confirm`** — feature folder; idempotency per §3 row 5;
  `docs.e2e-spec.ts` row. Also added a `400 MEDIA_UPLOAD_NOT_VERIFIED` path (not
  enumerated in §5's draft table) for when `verifyUpload` reports the asset never
  landed at the provider — the trust-check §6 describes needed *some* failure mode.
- [x] **7. `GET /v1/children/{childId}/media`** — feature folder, cursor pagination;
  `docs.e2e-spec.ts` row.
- [x] **8. e2e suite** — `test/media-upload.e2e-spec.ts`: full ticket→confirm round
  trip; a non-owning parent can't create a ticket for someone else's child; an
  assigned clinician can list but not create; a non-assigned clinician can't list;
  re-confirming with the same status is a no-op, a conflicting status is `409`; plus
  the `MEDIA_UPLOAD_NOT_VERIFIED` path via `FakeMediaStorageService.simulateMissing`.
- [x] **9. Verify** — `npm run lint && npm test && npm run build && npm run test:e2e`
  green; this plan and the `docs/plans/README.md` row flipped to **Done**.

## 8. Notes for the next phase

`MediaStorageService.createUploadTicket`/`verifyUpload` signatures, the `Media` row
shape, and the ownership-branch pattern in `ListMediaService` are now the precedent to
match for Phase 6 (`PlanTemplate`/`Plan`/`PlanNote`) and Phase 7 (`MonthlyCallLog`) —
cross-reference this doc's §3–§6 the same way this phase cross-referenced Phase 4's
`GetChildService`. Deferred/out-of-scope items called out in §2 (media deletion,
thumbnail pipeline, virus scanning, clinician/admin write access) were **not**
revisited — still explicitly not this phase's problem.

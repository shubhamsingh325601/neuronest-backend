# API conventions

The rules every endpoint follows, so new ones don't each re-decide. The reference for
*what* a given route does is the code and the OpenAPI spec at `/docs`; this is the
*why* and the shape.

## Resource naming

- **Collections are plural nouns**: `/clinicians`, `/users`. A single
  resource is a child path: `/users/{id}`.
- **No verbs in the path** for plain CRUD — the HTTP method is the verb.
- **Action-style endpoints are an allowed, documented exception.** When an operation is
  not CRUD on a resource — it's a state transition or a command — a verb sub-path is
  clearer than contorting it into REST. Current example: `POST /v1/users/me/deactivate`.
  Reach for this only when the alternative is a fake resource (`POST /deactivations`) or
  an overloaded `PATCH` that hides a side effect (session revocation, email dispatch).
  If it reads as "do X to this thing", an action path is right; if it reads as "change
  this field", use `PATCH`. Also current:
  `POST /v1/clinicians/{id}/resend-invitation` and `POST /v1/users/{id}/suspend` —
  each is an action with side effects (sends an email / revokes sessions), not a field
  edit. Resend returns **202** with no body; suspend returns **200** + a body.

## Methods

| Method | Semantics |
|--------|-----------|
| `GET` | Safe, idempotent, cacheable, **no side effects**. No request body — filters, pagination, and sorting are query params only. |
| `POST` | Create a resource (**201** + the created representation) **or** perform a non-idempotent action (**200/202/204** — see below). Not idempotent by default. |
| `PUT` | Full resource replacement, idempotent — the client sends the complete representation. Not used yet; reserved. |
| `PATCH` | Partial update. Design each one to be **idempotent in practice** (applying the same patch twice lands the same state) even though the spec doesn't require it. |
| `DELETE` | Idempotent — deleting something already gone returns the same success, never an unexpected error. |

### POST status codes

- **201 Created** — a resource was created. Return its representation.
  Example: `POST /v1/clinicians` → 201 + the `ClinicianDetailDto`.
- **200 OK** — the action completed synchronously and there's a body to return.
  Example: `POST /v1/auth/login` → 200 + tokens; `POST /v1/users/me/deactivate` → 200 +
  `{ status: 'DEACTIVATED', selfExcludedAt }`.
- **202 Accepted** — accepted for processing, outcome not yet known / deliberately not
  disclosed. Example: `POST /v1/auth/resend-verification` and
  `POST /v1/auth/forgot-password` always return 202 (they must not reveal whether the
  account exists). Since plan 0011 the 202 is genuinely asynchronous: the email is a
  queued job, so a mail-provider failure cannot change the response.
- **204 No Content** — completed, nothing to return. Example: `POST /v1/auth/logout`.

### Deliberate idempotency on POST

`POST` is not idempotent by default, but a specific endpoint may choose to behave
idempotently — document it where it happens. Current example: `POST /v1/auth/signup`
called again for an email that exists **but was never verified** returns **201**,
indistinguishable from a first signup. It **replaces** the stored password and name with
the new request's, revokes every refresh token, and issues a fresh code, all in one
transaction — so whoever verifies the latest code owns the account, and an earlier
squatter's password stops working (plan 0009 B-1). It does not leak that the address is
taken. Signup for an already-*verified* email, or for any row that is not a `PARENT`
(an invited clinician, an admin), is a real conflict → **409**, with no change made.

## Status codes in use

| Code | When |
|------|------|
| 200 | Success with a body (reads; actions that complete synchronously). |
| 201 | A resource was created; body is its representation. |
| 202 | Accepted for async / non-disclosed processing. |
| 204 | Success, no body. |
| 400 | Request failed validation (`VALIDATION_ERROR`, with `errors[]`); a malformed pagination cursor (`INVALID_CURSOR`); an unknown/expired account-setup token (`INVALID_SETUP_TOKEN`). |
| 401 | No/!invalid/expired credentials (`UNAUTHORIZED`, `MISSING_TOKEN`, `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`). |
| 403 | Authenticated but not allowed, or account not usable (`FORBIDDEN`, `INSUFFICIENT_PERMISSIONS`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_NOT_ACTIVE`). |
| 404 | No such resource / route (`NOT_FOUND`). |
| 409 | Conflict with current state (`EMAIL_ALREADY_REGISTERED`, `UNIQUE_CONSTRAINT`, `CLINICIAN_NOT_INVITED`). |
| 429 | Rate limit exceeded (`RATE_LIMITED`) — `/v1/auth/*` is fixed at 5 req/60 s. |
| 500 | Unhandled error (`INTERNAL_ERROR`) — reported to Sentry. |

Every non-2xx response is **RFC 9457 `application/problem+json`**:
`{ type, title, status, detail, instance, code, requestId, timestamp }`
(+ `errors: string[]` for 400s). `code` is the stable machine-readable identifier;
`type` is a URI built from it; `title` is a fixed phrase per `code`. See
[auth-flows.md](auth-flows.md) for the full list of `code` values and an example
payload, and [rbac.md](rbac.md) for the authz-specific ones.

> `GET /v1/health` also returns **503** (`SERVICE_UNAVAILABLE`) when the database probe
> fails — the one place a 5xx is an expected, non-Sentry outcome.

## Pagination

**Cursor-based.** List endpoints return:

```json
{ "data": [ ... ], "nextCursor": "string | null" }
```

requested via `?cursor=<opaque>&limit=<n>`. A `null` `nextCursor` means the last page.
`limit` defaults to 20 and is hard-capped at 100 (a larger value is a
`VALIDATION_ERROR`, not silently clamped). The cursor is an opaque base64url wrapper
over the last row's id; a malformed one is `400 INVALID_CURSOR`. Implementation:
`src/common/pagination/` (`CursorPaginationQueryDto`, `encodeCursor` / `decodeCursor` /
`toCursorPage`). First consumer: `GET /v1/clinicians`, sorted
`(createdAt desc, id desc)`.

**Exception — bounded, non-paginated lists.** A collection whose size is bounded by a
business rule (not an unbounded-over-time log) may return a plain array instead of the
`{ data, nextCursor }` envelope. Current example: `GET /v1/children/{id}/clinicians` —
a child's care team is a handful of clinicians, not a list that grows without bound
like plan history or media. Document this in the route's `@ApiOperation` summary;
default to cursor pagination unless a route has this kind of hard bound.

**Why cursors, not `?page=&pageSize=`:** the first list endpoint is the admin review
queue, whose contents change *while it is being paged* — every review removes an item.
Offset pagination on a shifting list silently skips or double-shows rows as earlier
items disappear. A cursor anchored to a stable sort key (e.g. `createdAt, id`) is
unaffected. Deciding this now so it isn't relitigated per-endpoint later; offset
pagination is not used anywhere.

## Media playback URLs

`GET /v1/children/{id}/media` (and any other endpoint returning a `MediaDto`) never
exposes Cloudinary's `storageKey`. Instead, each `UPLOADED` row carries a
`playbackUrl: string | null` — a mediated, per-request Cloudinary delivery URL, `null`
for anything not yet `UPLOADED`. It is minted fresh on every call, never persisted or
cached on the `Media` row, and the response is sent with `Cache-Control: no-store`.

**Current mechanism (implemented, confirmed against the live account):** assets are
uploaded and read as Cloudinary `type: 'authenticated'` delivery (not the public
default, which never required a signature at all) and the playback URL is
`sign_url: true`-signed. This account is on Cloudinary's **Free** plan
(`cloudinary.api.usage().plan === 'Free'`, checked at implementation time), which has
no token-based-authentication add-on — so the signed URL is signature-valid but does
**not** self-expire (`expiresAt` in `MediaStorageService.createPlaybackUrl`'s result is
honestly `null`). If the account is ever upgraded to a tier with that add-on,
`CloudinaryMediaStorageService.createPlaybackUrl` is the only place that needs to
change to add genuine time-boxed expiry — the `MediaDto`/controller contract already
supports a non-null `expiresAt`.

## Versioning

All domain routes are under `/v1/` (NestJS URI versioning, `defaultVersion: '1'`). The
rationale, and the two deliberate exceptions (`/health` alias, `/docs` + `/openapi.json`),
are in [architecture.md](architecture.md#api-versioning) — not restated here.

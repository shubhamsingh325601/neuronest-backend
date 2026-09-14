# Plan 0002 — Phase 2: Standards & Hardening

Status: **Done**
Owner: backend
Last updated: 2026-09-01

> Single source of truth for this phase. It tightens the foundation before the
> admin / clinician-review work lands on top — it is **not** a feature phase.

---

## 1. Context

Phase 1 (auth + onboarding, plan [0001](0001-phase-1-auth-onboarding.md)) shipped. Four
foundation gaps close here before the admin review queue is built:

1. **RBAC hardening** — a route cannot ship "authenticated but ungated" by omission; one
   written convention for adding a permission.
2. **RFC 9457** — the error envelope becomes `application/problem+json`; no behaviour,
   status code, or `code` value changes.
3. **API conventions doc** — one reference for naming, methods, status codes, pagination.
4. **Skill discovery** — a vetted candidate list; nothing installed.

**Out of scope / must not be scaffolded:** CASL / `AbilityFactory` / a permissions
table (the trigger — the first *conditional* rule — does not exist yet; migration path
is in [rbac.md](../rbac.md)); any new endpoint; a pagination *implementation*; any
central error-code enum (see §9); installing any skill.

## 2. Scope

**In:** a reflection-based RBAC coverage test; `docs/adding-a-permission.md`; rewrite of
`AllExceptionsFilter` + its DTO + OpenAPI wiring to RFC 9457; `docs/api-conventions.md`;
this plan + the skill candidate list.

**Out:** everything in §1's out-of-scope list. No Prisma schema change (§4). No route
added, renamed, or removed — `test/docs.e2e-spec.ts` is unchanged.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|----------|----------------|
| 1 | No CASL / policy engine this phase | Static role→permission map stays; CASL migration path already documented in [rbac.md](../rbac.md). Trigger to revisit: first rule needing a *condition*. |
| 2 | RBAC coverage is a **reflection** test, not a hand-maintained route list | `DiscoveryService` + `MetadataScanner` walk every registered controller; fails on a handler with neither `@Public()` nor a non-empty `@RequirePermissions()`. Also fails if a handler is both public and gated. |
| 3 | RFC 9457 `title` = Start Case of `code` | e.g. `INVALID_CREDENTIALS` → `"Invalid Credentials"`. Mechanical, no lookup table — avoids a second source of truth. |
| 4 | Validation `message` arrays → `detail` joined with `"; "`, raw array kept as `errors[]` extension member | Nothing from the old shape is lost. |
| 5 | `code`, `requestId`, `timestamp` are RFC 9457 extension members | Values unchanged from Phase 1. |
| 6 | OpenAPI error-shape wiring is minimal | Rework the DTO → `ProblemDetailsDto`, register via `extraModels`, add a `problem+json` example to the shared `Auth()` 401. Per-endpoint error responses stay undocumented as before. |
| 7 | Pagination = cursor-based `{ data, nextCursor }` via `?cursor=&limit=` | Decided now so it isn't relitigated per-endpoint. Reasoning (queue contents shift during review → offset drift) written in [api-conventions.md](../api-conventions.md). |
| 8 | Skill discovery is **propose-only** for third-party; repo-local skills are fine to add | Children's-data product; external skill supply-chain hygiene is a human decision. See §8. |
| 9 | Root `plan.md` **removed** | It was a 3-line pointer that read as a third top-level entrypoint alongside `README.md` and `docs/README.md`. Navigation now: root `README.md` → `docs/` (design) / `docs/plans/` (delivery). Supersedes 0001 decision D20's "root pointer" clause. |

## 4. Data model

**None.** No Prisma schema or migration change in this phase.

## 5. Endpoints

**No change** to any route, method, status code, `operationId`, or auth requirement.

The only wire-visible change: every **error** response is now
`Content-Type: application/problem+json` with the body
`{ type, title, status, detail, instance, code, requestId, timestamp }` (+ `errors[]`
for 400s). Success responses are untouched. Full `code` list + example payload in
[auth-flows.md](../auth-flows.md); the shape and status-code table in
[api-conventions.md](../api-conventions.md).

## 6. Cross-cutting

- **Errors** — `src/common/filters/all-exceptions.filter.ts` rewritten: `normalise()` /
  `defaultCode()` logic unchanged; new `toProblem` body + `Content-Type` header +
  `kebabCode` / `titleFromCode` helpers. DTO `src/common/dto/error-response.dto.ts` →
  `problem-details.dto.ts` (`ProblemDetailsDto`). `src/common/openapi/openapi.ts` gains
  `extraModels: [ProblemDetailsDto]`. `src/common/authz/auth.decorator.ts` — `Auth()`'s
  `ApiUnauthorizedResponse` gains a `problem+json` schema + example.
- **Authz** — no guard or `permissions.ts` change. New checklist doc
  `docs/adding-a-permission.md`; pointer added from [rbac.md](../rbac.md).
- **Docs** — new `docs/api-conventions.md` + `docs/adding-a-permission.md`, both linked
  from [docs/README.md](../README.md). `architecture.md` request-lifecycle wording and
  `AGENTS.md` errors line updated for the new envelope.
- **Tests** — new `test/rbac-route-coverage.e2e-spec.ts`,
  `test/error-shape.e2e-spec.ts`, `src/common/filters/all-exceptions.filter.spec.ts`;
  `type`/`status`/`content-type` assertions added to `auth`, `deactivate`,
  `clinician-application` e2e specs.

## 7. Build order (ordered checklist)

- [x] **A. RBAC hardening** — coverage test + `adding-a-permission.md` + rbac.md/README
  pointers. Verify: sanity-check the test fails when a decorator is removed, then
  `npm run lint && npm test && npm run test:e2e`.
- [x] **B. RFC 9457** — filter + DTO + OpenAPI + `Auth()` + docs + tests. Verify:
  full suite, plus `start:dev` smoke — `curl` a 401 and a 400, confirm
  `application/problem+json` and the body fields; confirm `ProblemDetailsDto` renders in
  Scalar at `/docs`.
- [x] **C. API conventions doc** — `docs/api-conventions.md` + README row. Verify: full
  suite (docs-only; `docs.e2e-spec.ts` still green), links resolve.
- [x] **D. Skill discovery** — this plan + §8 candidate list; `docs/plans/README.md`
  index row added. Repo-local skills vendored under `.claude/skills/` (see §8); no
  third-party skill installed.

## 8. Skills

### What was installed

Two **repo-local** skills under [`.claude/skills/`](../../.claude/skills/), written from
this repo's own `AGENTS.md` conventions — zero external supply chain:

| Skill | Triggers on | Does |
|-------|-------------|------|
| `feature-slice` | "add an endpoint", "new use-case", "new feature slice" | Walks the folder-per-use-case layout: `modules/<domain>/features/<use-case>/` files, path-alias imports, `@Auth()`/`@Public()` on every handler, explicit `operationId` + `@HttpCode`, DTO validation, the `.service.spec.ts`, and syncing `test/docs.e2e-spec.ts`'s `EXPECTED` list. |
| `add-permission` | "add a permission", "gate a route", "new `resource:action`" | The [adding-a-permission.md](../adding-a-permission.md) checklist as a skill: naming, `PERMISSIONS` tuple + `ROLE_PERMISSIONS`, `@Auth()`, service-side scope checks, and when a change needs a decision note in [rbac.md](../rbac.md). |

### Third-party — researched, none installed

Researched Aug 2026. Preference order per the kickoff: (1) Anthropic's official repo,
(2) audited marketplaces, (3) never vouch for a scraped-index skill without reading its
`SKILL.md` + every script it ships. Context: a 2026 audit found prompt injection in
~36% of tested skills, and skills can execute bundled scripts — so **instructions-only,
first-party** wins ties.

**Decision: install none.** The only close fit, `prisma-client-api`, is published for
Prisma **v7.9** — its `SKILL.md` teaches v7 client instantiation (driver adapter,
`../generated/client` import) and methods (`createManyAndReturn`) that do not match this
repo's deliberately-pinned Prisma **v6** + `PrismaService extends PrismaClient` setup.
Vendoring it would inject framing that contradicts the codebase — the opposite of what a
skill should do. Revisit if/when Prisma is unpinned.

### First-party, instructions-only — lowest risk

| Skill | Source | Helps with | Caveat |
|-------|--------|-----------|--------|
| `prisma-client-api` | [prisma/skills](https://github.com/prisma/skills) (Prisma org, MIT, no scripts) | Prisma Client query API reference — filters, transactions, `select`, raw SQL — while writing/reviewing service code | Written for Prisma **v7**; this repo is pinned to **v6** ([AGENTS.md](../../AGENTS.md)). Query API is largely version-stable, but verify anything new against the v6 docs. |
| `prisma-cli` | [prisma/skills](https://github.com/prisma/skills) | `prisma migrate` / `generate` / `db` command reference | v7 command surface — some flags differ from v6. Lower value than `prisma-client-api`. |
| `prisma-upgrade-v7` | [prisma/skills](https://github.com/prisma/skills) | Only relevant **if/when** the team decides to unpin Prisma from v6 | Not useful until that decision is made. |
| `skill-creator` | [anthropics/skills](https://github.com/anthropics/skills) (Anthropic, MIT) | Authoring a repo-local skill — e.g. turning `docs/adding-a-permission.md` into an executable skill, or a "new feature slice" scaffolder matching the folder-per-use-case convention | Meta-skill; adoption only makes sense if we decide to maintain in-repo skills. |
| `doc-coauthoring` | [anthropics/skills](https://github.com/anthropics/skills) | Longer-form writing/editing passes on the `docs/` narrative docs | General-purpose; marginal over current practice. |

### Not recommended

| Skill | Source | Why not |
|-------|--------|---------|
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) | Playwright/browser UI testing only. This is a headless REST API — Jest + `supertest` already cover it; the skill adds nothing. |
| `mcp-builder` | [anthropics/skills](https://github.com/anthropics/skills) | Only useful if we expose an MCP server. Not on any roadmap. |
| `claude-api` | [anthropics/skills](https://github.com/anthropics/skills) | Relevant only once the "AI engine" phase starts (explicitly out of scope now). Revisit then. |
| `nestjs-best-practices`, `nestjs-expert`, etc. | community (`giuseppe-trisciuoglio/developer-kit`, `jeffallan/claude-skills`, skillsmp.com listings) | Not first-party NestJS. Some ship `assets/` code templates and `rules/` files — the bundled-content review bar is high. Would need a full `SKILL.md` + `rules/` + `assets/` read and a security scan before anyone vouches; not done here. |
| Anything from `VoltAgent/awesome-agent-skills` / `skillsllm.com` / `explainx.ai` | large unaudited scraped indexes (1000+ entries) | Kickoff rule 3: skip unless a specific skill's `SKILL.md` and scripts have been read individually. None have. |

### On "audited" marketplaces

`skillstore.io` / [`aiskillstore/marketplace`](https://github.com/aiskillstore/marketplace)
runs an automated scan (flags `eval`/`exec`/raw system commands, out-of-scope file
access, network calls, obfuscation) plus a human review. The scan is **advisory only** —
a risk finding does not block publication. "Listed there" therefore means "scanned and
glanced at", not "cleared for a children's-data codebase". Treat a candidate from it
exactly like a community skill: read the `SKILL.md` and every script before adoption.

### Revisit later

- **`claude-api`** ([anthropics/skills](https://github.com/anthropics/skills)) — when the
  AI-engine phase opens.
- **`prisma-client-api` / `prisma-cli`** ([prisma/skills](https://github.com/prisma/skills))
  — when Prisma is unpinned from v6.
- Anything else only after someone has a concrete need and reads its `SKILL.md` + every
  script it ships.

## 9. Deferred / follow-ups

- **No central error-code registry.** `code` values (`INVALID_CREDENTIALS`,
  `EMAIL_NOT_VERIFIED`, …) are bare string literals at each `throw` site and in
  `AllExceptionsFilter`. A typo (`INVALID_CREDENTAILS`) compiles silently and only a
  test would catch it. Out of scope here — Piece 2 is envelope-only. A later phase could
  introduce a `const` catalogue + a `Permission`-style union (so throw sites are
  type-checked), or an ESLint rule. Not urgent while the set is small and covered by
  e2e assertions on `body.code`.

## 10. How to resume

> Phase 2 (plan `docs/plans/0002-phase-2-standards-hardening.md`) is code-complete and
> pending review. If continuing: confirm `npm run lint && npm test && npm run test:e2e`
> are green. Do not install a third-party skill — §8 explains why the Prisma ones are a
> version mismatch. Do not start CASL or a pagination implementation — both are
> explicitly deferred (§1, §9).

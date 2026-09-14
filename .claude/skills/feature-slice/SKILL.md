---
name: feature-slice
description: >-
  Add a new HTTP endpoint / use-case to the NeuroNest backend the way this repo
  structures them: one folder per use-case under src/modules/<domain>/features/,
  path-alias imports, an explicit auth decision on every handler, class-validated
  DTOs, a co-located unit spec, module wiring, and the docs-drift test kept in sync.
  Use when asked to "add an endpoint", "new use-case", "new feature slice", or to
  expose a new operation on an existing domain.
---

# Adding a feature slice

NeuroNest is a modular monolith: `src/modules/<domain>/` for domains,
`src/common/<concern>/` for shared infra. **No** controller/service/repository
layering — one folder per use-case, and Prisma is the repository layer. Match the
existing slices (`src/modules/auth/features/login/`,
`src/modules/users/features/get-me/`) exactly.

## Layout

```
src/modules/<domain>/features/<use-case>/
  <use-case>.controller.ts
  <use-case>.service.ts
  <use-case>.service.spec.ts        # unit test, next to the service
  dto/<use-case>.dto.ts             # request + response DTOs
```

Cross-feature helpers for a domain go in `src/modules/<domain>/shared/`, not in a
feature folder. A brand-new domain also needs `src/modules/<domain>/<domain>.module.ts`
and an import in `src/app.module.ts`.

## Rules (from AGENTS.md — non-negotiable)

- **Imports**: path aliases only, never `../`. `@app/*` → `src/*`, `@common/*` →
  `src/common/*`, `@modules/*` → `src/modules/*`, `@test/*` → `test/*`. Same-folder and
  child imports stay `./relative`.
- **Controller**:
  - `@Controller({ path: '<plural-resource>', version: '1' })` — every domain route is
    under `/v1/`. Plural nouns, no verbs in the path; an action sub-path
    (`users/me/deactivate`) is allowed only when the operation is not plain CRUD — see
    `docs/api-conventions.md`.
  - One `@ApiTags('<domain>')` on the class.
  - Every handler: `@ApiOperation({ operationId: '<camelCaseId>', summary: '...' })`.
  - Every handler: **an explicit auth decision** — `@Public()` or `@Auth('<permission>')`.
    A handler with neither fails `test/rbac-route-coverage.e2e-spec.ts`. Use the
    `add-permission` skill if the route needs a new permission.
  - `@HttpCode(...)` whenever the status is not the method default (POST→201, GET→200).
    See the POST status-code table in `docs/api-conventions.md` (200/201/202/204).
- **DTOs**: every field decorated with `class-validator`. The global `ValidationPipe`
  runs `whitelist` + `forbidNonWhitelisted` + `transform`, so an undeclared field is a
  400 `VALIDATION_ERROR`. Give response DTOs `@ApiProperty` for the spec.
- **Service**: inject `PrismaService` (and `EmailService` etc.) via the constructor.
  Throw stock Nest exceptions with an object body:
  `throw new ConflictException({ code: 'STABLE_CODE', message: '...' })`. `AllExceptionsFilter`
  repackages every throw into the RFC 9457 `application/problem+json` envelope — do not
  format errors yourself. Never leak account existence (see AGENTS.md).
  Ownership / "only your own record" is checked **inline here**, against the loaded row —
  not in a guard.
- **Module**: add the controller to `controllers: [...]` and the service to
  `providers: [...]` in `<domain>.module.ts`.

## Tests

- `<use-case>.service.spec.ts` — unit, next to the service. Mock `PrismaService` and
  `EmailService` (`{ user: { findUnique: jest.fn() } }` style, `Test.createTestingModule`
  with `useValue`). No DB. Cover the happy path and each thrown `code`.
- If the slice is a significant flow, add or extend a `test/<name>.e2e-spec.ts` using
  `createTestApp()` from `test/helpers/test-app.ts` (real app, `FakeEmailService`,
  throwaway Postgres).

## Keep the OpenAPI drift test green

`test/docs.e2e-spec.ts` holds an `EXPECTED` array of every `{ method, path, operationId }`.
The spec is built from live metadata at boot, so **add your new route's row** or the
suite fails. Match the `operationId` you put in `@ApiOperation`.

## Verify

```bash
npm run lint
npm test
docker compose up -d && npm run test:e2e
```

All of `docs.e2e-spec.ts`, `rbac-route-coverage.e2e-spec.ts`, and your new specs must
pass.

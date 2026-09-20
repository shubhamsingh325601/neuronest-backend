# Architecture

This document defines the high-level system architecture, request lifecycle, observability, and long-term scalability design for the NeuroNest backend.

---

## 1. System Topology: Modular Monolith

NeuroNest is structured as a **modular monolith** running on NestJS 11 and Node 22. Domain logic is segregated into bounded modules (`src/modules/<domain>/`), while shared cross-cutting concerns reside in `src/common/<concern>/`.

There is deliberately no microservice mesh, event bus, or distributed database at this stage. The modular monolith provides maximal developer velocity, unified transactions, simple deployments, and zero network serialization overhead. If a specific domain (such as real-time audio/video processing or AI inference) requires independent scaling in the future, the module boundary provides the natural extraction seam.

### Domain Modules
| Module | Responsibility |
|---|---|
| `auth` | Signup, email verification, login, refresh rotation, logout, password reset |
| `users` | Current user profile (`GET /users/me`), self-deactivation |
| `clinicians` | Public clinician application intake and admin review workflow |
| `children` | Core Care Domain foundation: the `Child` record and clinician↔child assignment |
| `health` | Liveness and database connectivity probes |

### Common Infrastructure Modules
Shared infrastructure modules are marked `@Global()` when dependency injection is required across modules:
- `PrismaModule`: Database connectivity and transaction management (`@common/prisma`).
- `EmailModule`: Abstract email delivery provider (`@common/email`).
- `CryptoModule`: Cryptographic utilities, argon2id hashing, and SHA-256 token hashing (`@common/crypto`).
- `AuthzModule`: Static RBAC permission mapping and guards (`@common/authz`).
- `LoggingModule`: Structured Pino logging and request correlation (`@common/logging`).

---

## 2. Layout: Feature Folders per Use-Case

Within domain modules, NeuroNest avoids traditional horizontal layering (controllers &rarr; services &rarr; repositories). Instead, code is organized by **vertical use-case slices**:

```
src/modules/auth/
  auth.module.ts
  shared/                         # Utilities shared across multiple features in this module
    refresh-token.service.ts
    verification-token.service.ts
    session-tokens.dto.ts
  features/
    signup/
      signup.controller.ts
      signup.service.ts
      signup.service.spec.ts      # Co-located unit test
      dto/signup.dto.ts           # Input/Output DTOs for this feature
    login/
      ...
```

### Rationale
- **High Cohesion**: Everything required to understand, modify, or test an endpoint exists in one directory.
- **Self-Documenting Codebase**: The directory tree doubles as a feature catalog.
- **No Redundant Abstractions**: Prisma is the data access layer; handwritten repositories are avoided.

---

## 3. Request Lifecycle Pipeline

Every incoming HTTP request passes through an explicit, ordered pipeline:

```
Incoming Request
  │
  ├─ 1. ThrottlerGuard (APP_GUARD)
  │     Evaluates IP-based rate limits. @AuthThrottle() tightens auth routes to 5 req/60s.
  │
  ├─ 2. JwtAuthGuard (APP_GUARD)
  │     Validates access token signature and expiration.
  │     Re-reads user status from DB: rejects DEACTIVATED / SUSPENDED accounts immediately.
  │     Skipped if the handler is decorated with @Public().
  │
  ├─ 3. PermissionsGuard (APP_GUARD)
  │     Evaluates user role against the static ROLE_PERMISSIONS map.
  │     Enforces @Auth('<permission>') or @RequirePermissions('<permission>').
  │
  ├─ 4. ValidationPipe (Global)
  │     Runs class-validator on the request body/query DTO.
  │     Enforces whitelist: true, forbidNonWhitelisted: true, and transform: true.
  │
  ├─ 5. Controller & Service Execution
  │     Controller handles HTTP parameter binding.
  │     Service executes business logic and database queries.
  │     Data ownership / tenancy checks ("can user X access resource Y?") happen here.
  │
  └─ 6. AllExceptionsFilter (Global Filter)
        Catches all thrown exceptions and standardizes them into the
        RFC 9457 `application/problem+json` envelope.
        Captures 5xx server errors in Sentry.
```

---

## 4. API Versioning & Routing

- **URI Versioning**: Configured with `defaultVersion: '1'` in `main.ts`. All domain routes are exposed under `/v1/` (e.g. `/v1/auth/login`, `/v1/users/me`).
- **Unversioned Paths**:
  - `GET /health` is exposed version-neutral (`HealthAliasController`) for infrastructure health checkers, while `GET /v1/health` is documented in OpenAPI.
  - `/docs` (Scalar API reference) and `/openapi.json` (raw OpenAPI document) are mounted directly on the Express instance outside the versioning router.

---

## 5. In-House Authentication Architecture

NeuroNest uses a self-contained authentication architecture rather than external IDPs (Auth0, Cognito, Firebase):

1. **Opaque Rotating Refresh Tokens**:
   - 32-byte cryptographically secure random tokens.
   - Only the SHA-256 hash is stored in PostgreSQL (`RefreshToken` table).
   - Rotated on every refresh call: the old token is revoked, and a new pair is issued.
   - Automatic family reuse detection: using an already-revoked refresh token revokes all active sessions for that user family.
2. **Short-Lived Stateless Access Tokens**:
   - Signed JWTs containing `sub`, `email`, and `role`.
   - Verified statelessly, but complemented by DB-backed account status checks in `JwtAuthGuard` to ensure instant revocation upon suspension or deactivation.
3. **Password Security**:
   - Argon2id with production memory and iteration parameters (`ARGON2_*`).
4. **Data Ownership & Privacy**:
   - All user data and credentials remain strictly within our PostgreSQL instance, fulfilling healthcare privacy and regulatory standards.

---

## 6. Observability & Error Handling

- **Structured JSON Logging (`nestjs-pino`)**:
  - Every request is tagged with a unique `requestId` (`x-request-id` header or UUIDv4).
  - Sensitive parameters (passwords, tokens, authorization headers) are redacted automatically.
  - Pretty-printing enabled in local development; high-performance JSON emitted in production.
- **RFC 9457 Problem Details**:
  - All errors (validation, business logic, unauthorized access, server crashes) conform to the RFC 9457 standard (`application/problem+json`).
  - See [`docs/api-conventions.md`](api-conventions.md) for full envelope details.
- **Error Tracking (`@sentry/nestjs`)**:
  - Initialized at application startup (`src/instrument.ts`).
  - `AllExceptionsFilter` automatically logs unhandled 5xx exceptions to Sentry with the attached `requestId`.

---

## 7. 2–3 Year Scalability & Growth Seams

The architecture is deliberately designed to scale seamlessly for 2–3 years through predictable traffic milestones:

### 1. Stateless Horizontally Scalable Application Instances
The NestJS application maintains zero in-memory session state. All session persistence lives in PostgreSQL via hashed refresh tokens. Multiple instances of the backend container can run behind an Application Load Balancer (ALB / Nginx) with round-robin routing.

### 2. Database Scaling Path
- **Read Replicas**: For read-heavy operations (e.g. reading clinical questionnaires or user profiles), Prisma supports read/write replica routing (`@prisma/extension-read-replicas`).
- **Connection Pooling**: Managed via PgBouncer or Neon connection poolers for high-concurrency connection scaling.

### 3. Caching & Distributed State Seam (Redis)
When request volume reaches thresholds requiring distributed caching:
- Rate limiting can migrate from `@nestjs/throttler` in-memory storage to `@nest-lab/throttler-storage-redis`.
- User permission caching can be layered into `PermissionsGuard` without altering domain services.

### 4. Forward-Compatible Data Modeling
- **Relational Normalization (3NF)** ensures referential integrity as core data volume expands.
- **PostgreSQL `jsonb`** is utilized for extensible schemas (clinical responses, flexible metadata, audit snapshots) without requiring disruptive schema migrations.

---

## 8. Deep-Dive References

- [API Conventions & Error Shapes](api-conventions.md) — HTTP verbs, RFC 9457 Problem Details, status codes.
- [Database & Docker Architecture](database-and-docker.md) — PostgreSQL conventions, JSONB, Docker Compose, Prisma migrations.
- [Testing Architecture](testing.md) — Unit test mocking, E2E test setup, guardrail suites.
- [Authentication Sequences](auth-flows.md) — Step-by-step token flows and state transitions.
- [Role-Based Access Control (RBAC)](rbac.md) — Static permission mapping and authorization guards.

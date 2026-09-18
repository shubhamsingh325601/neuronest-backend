# Testing Guide

This document outlines the testing philosophy, architectural patterns, execution workflows, and automated guardrails for the NeuroNest backend.

---

## 1. Testing Philosophy

NeuroNest follows a two-tier testing strategy designed for high confidence, fast feedback loops, and zero flaky tests:

1. **Unit Tests (Fast, Co-located, Zero DB)**: Validate business logic, edge cases, error code throws, and domain rules in isolation.
2. **End-to-End (E2E) Tests (Real Application, Local PostgreSQL)**: Validate full HTTP request lifecycles, authentication guards, database queries, transactions, and error envelopes.

```
┌─────────────────────────────────────────────────────────────┐
│                    E2E Tests (`test/`)                      │
│   Real Nest App + Local Docker Postgres + FakeEmailService   │
│   Tests full request/response lifecycle, guards, & queries   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                    Unit Tests (`src/`)                      │
│   Next to each service (`*.service.spec.ts`)                │
│   100% Mocked Prisma & Email; Zero network or DB access     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Unit Testing (`src/**/*.spec.ts`)

Every service must have a corresponding `*.service.spec.ts` co-located in the same directory.

### Conventions
- **No Database Connection**: Unit tests must **never** connect to a database or network service.
- **Mock `PrismaService`**: Mock Prisma client methods using Jest functions:
  ```typescript
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };
  ```
- **Mock `EmailService`**: Mock the abstract `EmailService` provider (`{ sendEmail: jest.fn() }`).
- **Test Matrix per Service**:
  - Happy path execution.
  - Validation / precondition failures.
  - Explicit error handling: assert that the thrown `HttpException` contains the expected RFC 9457 `code` and HTTP status.

### Example Unit Spec Skeleton

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { EmailService } from '@common/email/email.service';
import { SignupService } from './signup.service';

describe('SignupService', () => {
  let service: SignupService;
  let prisma: typeof mockPrisma;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: { sendVerificationEmail: jest.fn() } },
      ],
    }).compile();

    service = module.get<SignupService>(SignupService);
  });

  it('throws CONFLICT when email is already registered', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-id' });

    await expect(service.execute({ email: 'test@example.com', password: 'Password123!', name: 'Alex' }))
      .rejects.toThrow(ConflictException);
  });
});
```

---

## 3. End-to-End (E2E) Testing (`test/*.e2e-spec.ts`)

E2E tests execute HTTP requests against a fully booted NestJS application.

### Infrastructure & Lifecycle
- **Database Isolation**: E2E tests run against the ephemeral test database defined by `TEST_DATABASE_URL` (typically `postgresql://neuronest:neuronest@localhost:5432/neuronest?schema=public`).
- **Pre-flight Migration (`test/helpers/global-setup.ts`)**: Jest executes `global-setup.ts` before any test suite runs, deploying all migrations via `prisma migrate deploy`.
- **Per-Suite Truncation**: Between test suites, database tables are truncated to guarantee total test isolation.
- **App Factory (`test/helpers/test-app.ts`)**: The `createTestApp()` helper boots NestJS with the exact same middleware, pipes, exception filters, and security configurations used in production, replacing only `EmailService` with `FakeEmailService` (which records outgoing emails in memory for assertions).

### Available E2E Suites

| Suite | File | What it Validates |
|---|---|---|
| **Auth Lifecycle** | `test/auth.e2e-spec.ts` | Complete flow: signup &rarr; email verify &rarr; login &rarr; refresh rotation &rarr; logout |
| **Account Deactivation** | `test/deactivate.e2e-spec.ts` | User self-deactivation, token revocation, immediate session termination |
| **Clinician Applications** | `test/clinician-application.e2e-spec.ts` | Public submission, admin list/review/approve/reject, account setup token |
| **Error Shape** | `test/error-shape.e2e-spec.ts` | Verification that all errors conform to RFC 9457 `application/problem+json` |
| **RBAC Route Coverage** | `test/rbac-route-coverage.e2e-spec.ts` | Asserts every route is explicitly protected or explicitly marked `@Public()` |
| **OpenAPI Contract Drift** | `test/docs.e2e-spec.ts` | Live OpenAPI spec reflection matching expected paths and `operationId`s |

---

## 4. Automated Guardrails

NeuroNest incorporates two specialized E2E guardrail suites that prevent security regressions and undocumented API drift:

### 1. RBAC Route Coverage Guard (`rbac-route-coverage.e2e-spec.ts`)
Iterates over every registered controller endpoint at test runtime:
- Verifies that the endpoint has an explicit security annotation: either `@Public()` or `@Auth('<permission>')` / `@RequirePermissions(...)`.
- If an engineer introduces a new controller handler and forgets to declare auth metadata, the build immediately fails.

### 2. Contract Drift Guard (`docs.e2e-spec.ts`)
Generates the OpenAPI 3.0 document in memory and checks it against an `EXPECTED` list of routes:
- Asserts that method, path, and `operationId` match exactly.
- If you add or modify a route, you must update `EXPECTED` in `test/docs.e2e-spec.ts`. This ensures documentation drift is caught at build time.

---

## 5. Running Tests

### Unit Tests
```bash
npm test                             # Run all unit tests
npm run test:watch                   # Run unit tests in interactive watch mode
npm run test:cov                     # Run unit tests and generate coverage report
npx jest src/modules/auth            # Run unit tests for a specific module
```

### E2E Tests
E2E tests require local PostgreSQL to be running:
```bash
# 1. Start local Postgres container
npm run docker:up

# 2. Run all E2E tests (runs sequentially via --runInBand)
npm run test:e2e

# 3. Run a specific E2E test file
npx jest --config ./test/jest-e2e.config.ts test/auth.e2e-spec.ts
```

---

## 6. Performance & Troubleshooting

- **`ts-jest` Overhead**: `ts-jest` performs type checking per file during test execution. If speed becomes a concern during development, run specific test files rather than the entire suite.
- **E2E Connection Refused**:
  - *Symptom*: `Error: connection refused` or `database unreachable`.
  - *Fix*: Local Docker Postgres is not running. Run `npm run docker:up` and verify with `docker compose ps`.
- **Database Locking / Pool Exhaustion in E2E**:
  - E2E tests run sequentially using `--runInBand` (configured in `package.json`). Do not remove `--runInBand` from `test:e2e`, as parallel suites sharing `TEST_DATABASE_URL` will cause data collisions during table truncation.

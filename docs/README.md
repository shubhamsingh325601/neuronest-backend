# NeuroNest Backend — Technical Documentation

This directory contains the narrative and architectural documentation for the NeuroNest backend.

While the live code and OpenAPI specification at `/docs` define **what** the system does, these documents capture the **why**, the architectural boundaries, the data design, and the operational guardrails.

---

## Documentation Directory & Reading Guide

Use this matrix to identify which document to consult for your current task without loading unnecessary context:

| Document | Scope & Contents | Consult When |
|---|---|---|
| [`architecture.md`](architecture.md) | Modular monolith topology, feature-folder structure, request pipeline (guards & filters), in-house JWT rationale, observability, and 2–3 year scalability design. | Planning a new module, reviewing request lifecycle, or designing architectural seams. |
| [`api-conventions.md`](api-conventions.md) | RESTful URL conventions, HTTP verb semantics, status codes, cursor-based pagination, and the RFC 9457 `application/problem+json` error envelope. | Exposing a new HTTP endpoint, defining DTOs, or throwing domain errors. |
| [`database-and-docker.md`](database-and-docker.md) | PostgreSQL 16 schema standards, 3NF normalization, JSONB usage, dual-database architecture (dev vs test), Docker Compose orchestration, and Prisma migration lifecycles. | Modifying `schema.prisma`, running migrations, managing local Docker Postgres, or writing queries. |
| [`testing.md`](testing.md) | Unit testing philosophy (co-located, mocked Prisma/Email), E2E testing with throwaway Postgres, test data truncation, and automated guardrails (OpenAPI drift & RBAC coverage). | Writing unit tests, authoring E2E tests, or diagnosing CI/test failures. |
| [`schema-decisions.md`](schema-decisions.md) | Detailed rationale behind every table, column, index, UUIDv4 decision, and the polymorphic `VerificationToken` architecture. | Altering existing database tables or adding new relational entities. |
| [`auth-flows.md`](auth-flows.md) | Step-by-step state diagrams and sequences: signup, email verification, login, rotating refresh tokens with family revocation, password reset, and account deactivation. | Working on authentication logic, token lifetimes, or security-sensitive user flows. |
| [`rbac.md`](rbac.md) | Static `ROLE_PERMISSIONS` mapping, authorization guards (`@Auth`), permission-adding checklist, and future CASL migration triggers. | Modifying role capabilities, introducing new permissions, or gating endpoints. |
| [`plans/`](plans/README.md) | Delivery plans indexed by development phase. Active plan: `0003-phase-3-clinician-review.md`. | Reviewing project roadmap, phase milestones, and completed features. |

---

## Related Repositories & Guides

- **Root Developer Guide**: [`../README.md`](../README.md) — Local prerequisites, quickstart, and npm scripts.
- **Agent Instructions**: [`../AGENTS.md`](../AGENTS.md) — Cardinal rules, coding standards, and AI agent context-loading matrix.
- **Claude Agent Skills**: [`../.claude/skills/`](../.claude/skills/) — Repo-local executable workflows (`feature-slice`, `add-permission`, `prisma-migration`).

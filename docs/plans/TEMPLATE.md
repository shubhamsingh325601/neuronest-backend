# Plan NNNN — <Title>

Status: **DRAFT** | **Active** | **Done** | **Superseded** | **Parked**
Owner: <name>
Last updated: <YYYY-MM-DD>

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code.

---

## 1. Context

What this phase is, how it fits the product, and — explicitly — what is **out of scope**
and must not be scaffolded.

## 2. Scope

In / out, as concretely as possible. List the endpoints and modules that ship.

## 3. Locked decisions (do not relitigate)

Numbered table `| # | Decision | Notes / status |`. One row per decision that would
otherwise get re-argued. Append later rounds as dated sub-sections rather than editing
history.

## 4. Data model

Final Prisma models for the phase — every table, every field, every index, with the
rationale for anything non-obvious. Note additions made on top of the brief.

## 5. Endpoints

Table `| Method | Path | operationId | Auth | Notes |`. Include version prefix and any
unversioned exceptions. Note the shared response DTOs.

## 6. Cross-cutting

Config, logging, errors, rate limiting, auth, validation, OpenAPI, observability, Docker,
seeds — whatever infrastructure this phase establishes or depends on.

## 7. Build order (ordered checklist)

Steps A, B, C… each a `- [ ]` checklist. Order matters — later steps assume earlier ones.
Include verification steps (build, migrate, seed, runtime smoke test, test suites).

## 8. How to resume

A paste-ready prompt for the next session that assumes nothing and points back here.

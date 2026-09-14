# NeuroNest backend — design docs

Narrative documentation for the backend. These describe **why** the code is shaped the
way it is; the code itself and the OpenAPI spec at `/docs` are the reference for
**what** it does.

| Doc | Covers |
|-----|--------|
| [architecture.md](architecture.md) | Modular monolith, feature-folder layout, URI versioning, request lifecycle, why in-house JWT |
| [api-conventions.md](api-conventions.md) | Resource naming, HTTP method + status-code semantics, the RFC 9457 error shape, cursor pagination |
| [schema-decisions.md](schema-decisions.md) | Every table and field, the `VerificationToken` design, opaque refresh tokens, index choices |
| [auth-flows.md](auth-flows.md) | Step-by-step sequences: signup→verify→login→refresh→logout, forgot→reset, deactivate; TTLs and revocation rules |
| [rbac.md](rbac.md) | The static `ROLE_PERMISSIONS` map, guard order, the `@casl/ability` migration path |
| [adding-a-permission.md](adding-a-permission.md) | Checklist for introducing a new permission: naming, where to declare/grant it, when to write a decision note |
| [plans/](plans/README.md) | Delivery plans, one file per phase. Active: `0003-phase-3-clinician-review.md` |

See also the root [`README.md`](../README.md) for setup and scripts, and
[`AGENTS.md`](../AGENTS.md) for contributor / agent conventions.

# Delivery plans

One file per phase, `NNNN-short-title.md`. Each plan is the single source of truth for
its phase: every decision, convention, and an ordered checklist so work can resume cold.
New plans start from [`TEMPLATE.md`](TEMPLATE.md).

| # | Title | Status | File |
|---|-------|--------|------|
| 0001 | Phase 1 — Auth & Onboarding Foundation | Done | [0001-phase-1-auth-onboarding.md](0001-phase-1-auth-onboarding.md) |
| 0002 | Phase 2 — Standards & Hardening | Done | [0002-phase-2-standards-hardening.md](0002-phase-2-standards-hardening.md) |
| 0003 | Phase 3 — Clinician Application Review (Admin) | Done | [0003-phase-3-clinician-review.md](0003-phase-3-clinician-review.md) |
| 0004 | Phase 4 — Child + Clinician↔Child Foundation | Done | [0004-phase-4-child-clinician-foundation.md](0004-phase-4-child-clinician-foundation.md) |
| 0005 | Phase 5 — Media Upload (Cloudinary, abstracted) | Done | [0005-phase-5-media-upload.md](0005-phase-5-media-upload.md) |
| 0006 | Phase 6 — Plan Domain (Templates, Assignment, Clinician Notes) | Done | [0006-phase-6-plan-domain.md](0006-phase-6-plan-domain.md) |
| 0007 | Phase 7 — Monthly Call Log | Done | [0007-phase-7-monthly-call-log.md](0007-phase-7-monthly-call-log.md) |
| 0008 | Phase 8 — Backend API Completion | Done | [0008-phase-8-backend-api-completion.md](0008-phase-8-backend-api-completion.md) |

Status values: **Active** (in progress) · **Done** · **Superseded** · **Parked**. Phase
8 closed the API-surface gaps found by a post-Phase-7 audit — access-lifecycle
(revoke/suspend), plan history, a secure media playback contract, an admin user
directory, authenticated change-password, and a fixed-shape admin summary. D2
(ETag/conditional-GET) was deliberately left deferred, per the plan's own
conditional-scope note — see the plan doc's closing summary.

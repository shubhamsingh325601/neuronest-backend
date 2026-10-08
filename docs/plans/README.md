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
| 0009 | Phase 9 — Security Fixes, Contract Fixes, Parent Plan Read | Done | [0009-phase-9-security-and-contract-fixes.md](0009-phase-9-security-and-contract-fixes.md) |
| 0010 | Phase 10 — Clinician Lifecycle (Admin-Created) | Done | [0010-phase-10-clinician-lifecycle.md](0010-phase-10-clinician-lifecycle.md) |
| 0011 | Phase 11 — Postgres Job Queue, Async Email, Stale-Media Cleanup | Done | [0011-phase-11-postgres-job-queue.md](0011-phase-11-postgres-job-queue.md) |
| 0012 | Phase 12 — Media Consent Record and Manual Weekly Coaching | Done | [0012-phase-12-consent-and-coaching.md](0012-phase-12-consent-and-coaching.md) |
| 0013 | Phase 13 — Child Progress Tracking and Weekly Summary | Done | [0013-phase-13-progress-tracking.md](0013-phase-13-progress-tracking.md) |
| 0014 | Phase 14 — Monthly Call Appointments | Done | [0014-phase-14-monthly-call-appointments.md](0014-phase-14-monthly-call-appointments.md) |
| 0015 | Phase 15 — Escalation Lifecycle (owner/notification blocked on D-3/D-16) | Proposed | [0015-phase-15-escalation-lifecycle.md](0015-phase-15-escalation-lifecycle.md) |
| 0016 | Phase 16 — Plan Content Model (Template → Per-Child Plan) | Done | [0016-phase-16-plan-content-model.md](0016-phase-16-plan-content-model.md) |
| 0017 | Phase 17 — Parent App Integration Gaps (profile, care plan, password-reset code, escalations) | Active | [0017-phase-17-parent-app-integration.md](0017-phase-17-parent-app-integration.md) |
| 0018 | Phase 18 — AI Foundation (Vercel AI SDK, Gemini-first) and Parent AI Coaching Tip | Proposed | [0018-phase-18-ai-foundation.md](0018-phase-18-ai-foundation.md) |

Plans 0009–0015 come from the frontend's V1 backend handoff
(`docs/NeuroNest_Backend_V1_Developer_Handoff.docx`), audited against the code on
2026-10-04. AI work and parent↔clinician chat are deliberately excluded. Suggested order:
0009 → 0010 → 0011, then 0016 (after a product walk-through), then 0012/0013/0014 (independent of each other); 0015 waits on D-3/D-16 for owner/notification.

Status values: **Proposed** (written, awaiting review/approval) · **Active** (in progress) · **Done** · **Superseded** · **Parked**. Phase
8 closed the API-surface gaps found by a post-Phase-7 audit — access-lifecycle
(revoke/suspend), plan history, a secure media playback contract, an admin user
directory, authenticated change-password, and a fixed-shape admin summary. D2
(ETag/conditional-GET) was deliberately left deferred, per the plan's own
conditional-scope note — see the plan doc's closing summary.

**Decision (2026-10-04): no IP-based rate limiting.** `TRUST_PROXY_HOPS` and all proxy-hop
handling were removed (supersedes 0009 §3 rows 4/4a and step 2.4). Rate limits key on user
id / email / token instead; see `src/common/throttler/app-throttler.guard.ts`. Revisit only
if traffic requires an IP layer.

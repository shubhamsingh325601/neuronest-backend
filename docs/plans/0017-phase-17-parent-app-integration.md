# Plan 0017 — Phase 17: Parent App Integration Gaps

Status: **Done** (2026-10-10). Batches A, B, C and G are implemented with unit + e2e tests. Batch F (escalations) is being removed by plan 0019 (Batch 1).
Owner: backend
Last updated: 2026-10-10

> Record of this phase. Authored from the Parent mobile app's screen-by-screen
> audit (`neuroNest/docs/PARENT_API_INTEGRATION_PLAN.md`) against the code after plans 0009–0014 and 0016.
> AI, chat and conversation summaries are plans 0018 and 0019, not this phase.

---

## 1. Context

The Parent app runs on mock repositories. Wiring it to the API exposed gaps. Product decisions:

- Clinicians never chat — they review summaries.
- AI is not part of this phase. The AI foundation is plan 0018; chat and summaries are plan 0019.

**Out of scope:** AI / LLM, notifications, billing, websockets, join links for calls (D-9).

## 2. Scope (batches — each ships with unit + e2e tests and a docs/EXPECTED update)

| Batch | Ships |
|---|---|
| A | `PATCH /users/me` (name); child profile columns + `PATCH /children/{id}`; clinician-authored `clinicalProfile` + `PUT /children/{id}/clinical-profile` |
| B | Structured plan content (`PlanWeek`, `PlanGoal`, `PlanActivity`) + `PUT /plans/{id}/weeks/{n}`; `ActivityCompletion`; parent reads `GET /children/{id}/care-plan`, completes / resets activities |
| C | Mobile password reset: 6-digit reset code by email (`POST /auth/reset-password` accepts `{email, code, newPassword}`) |

(Batches D = analyses and E = chat were dropped. Batch F = escalations was built and is removed again by plan 0019 Batch 1 (decided 2026-10-10).)

## 3. Locked decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Parent-editable child fields are typed columns (`preferredName`, `gender`, `primaryLanguage`, `accommodations`); clinician-authored profile is one JSONB `clinicalProfile` | Parent reads both, writes only the columns |
| 2 | `PATCH /users/me` changes `name` only; email change needs a verification flow and is deferred | |
| 3 | Care-plan structure is per-plan rows (not template-level) in this phase; the clinician app will author them | Templates keep days/sections |

## 4. Data model (added tables / columns)

- `children`: `preferredName`, `gender`, `primaryLanguage`, `accommodations` (parent-editable), `clinicalProfile` JSONB (clinician-authored).
- `plan_weeks`, `plan_goals`, `plan_activities` (per-plan content; rows keyed by `(planId, weekNumber)` / `(weekId, position)`), `activity_completions` (one row per activity; delete = reset).
- `VerificationTokenType.PASSWORD_RESET_CODE`.

## 5. Endpoints added

| Method | Path | operationId | Auth |
|---|---|---|---|
| PATCH | `/v1/users/me` | usersUpdateMe | `user:update:self` |
| PATCH | `/v1/children/{id}` | childUpdate | `child:update:self` |
| PUT | `/v1/children/{id}/clinical-profile` | childClinicalProfileSet | `child-clinical-profile:manage` |
| PUT | `/v1/plans/{id}/weeks/{weekNumber}` | planWeekUpsert | `plan:manage` |
| GET | `/v1/children/{childId}/care-plan` | carePlanGet | `plan:read` |
| POST/DELETE | `/v1/children/{childId}/activities/{activityId}/completion` | activityComplete / activityReset | `activity:complete:self` |
| POST | `/v1/auth/reset-password` | authResetPassword | public — now also `{email, code, newPassword}` |
| PUT | `/v1/appointments/{id}/preparation` | appointmentSavePreparation | `appointment:prepare:self` (parent, own child, until the call ends) |
| PUT | `/v1/appointments/{id}/summary` | appointmentSetSummary | `appointment:summarise` (assigned clinician / admin, once the call has started) |
| GET/PATCH | `/v1/users/me/preferences` | usersGetPreferences / usersUpdatePreferences | `user:read:self` / `user:update:self` |

## 6. Cross-cutting

- **Batch G (parent app fully dynamic):** appointments carry the parent's call preparation (`prepTopicIds` = plan-goal ids, `prepChecklistIds`), the clinician's `summary` / `actionPoints` and the slot's `meetingUrl` (https, set when the slot is published); coaching tips gain optional `whyItMatters` / `steps` / `scriptQuote` / `scriptContext`; `UserPreference` holds notification and archive choices; `GET /children/{id}/care-plan` and `/coaching` take `tzOffsetMinutes` so the plan day follows the parent's local calendar day.
- **Password reset:** the reset email now carries a 6-digit code next to the link; the code is attempt-limited and burns the link on use (and vice versa).

## 7. Status

Batches A, B, C and G are implemented with unit + e2e tests. Batch G (call preparation, call summary, meeting link, preferences, rich coaching tips, local plan day) is included. Batch F (escalations) is removed by plan 0019 Batch 1 (decided 2026-10-10).

**Deferred (not built, not scheduled; each needs its own plan):** email change (needs a verification flow); template-level structured plan content; delivery of email / WhatsApp / reminder messages (needs a notification service).

## 8. How to resume

This phase is Done. For new work see plans 0018 and 0019. To wire the Parent app screen by screen, read `neuroNest/docs/PARENT_API_INTEGRATION_PLAN.md`.

# Plan 0020 — Phase 20: Personal AI Chat (names, profile, plan detail, lists, opening greeting)

Status: **Done** (approved 2026-10-22; implemented 2026-10-23; C.2 live eval moved to staging by the owner, see section 9)
Owner: backend
Last updated: 2026-10-23

> This file is the single source of truth for this phase. It carries every decision,
> convention, and the exact remaining checklist so work can resume cold. Read it top to
> bottom before touching code. All work is development/staging with synthetic data.

---

## 1. Context

The guided AI chat (plan 0019) works on staging with `AI_MODEL=google:gemini-3-flash-preview`. The remaining problem is the experience and the
answers, not the model.

When a parent says "hello", the AI answers *"I can't see names / I have no personal information"*. That is **scripted, not a bug**: chat.v2 rule 10
and `smallTalkReply()` (`src/modules/conversations/shared/ai-chat.constants.ts`) say so on purpose, because plan 0019 §3 row 18, §6.1 and §6.3 keep
every name away from the model (allow-list context, `redactPii` strips child, parent and care-team names, the output filter blocks them).

What the model receives today: the child's **age**, and a per-topic slice (today's plan day; plan *titles* only; last-week counts). It does not
receive names, gender, the clinician's profile (strengths, sensory traits, calming preferences, communication) or plan content beyond titles.
Rule 8 also forbids lists, so step-by-step answers cannot be shown as lists.

Also: the parent picks a topic and the chat opens empty.

**Out of scope (do not scaffold):** any change to `AI_MODEL`, `AI_FALLBACK_MODEL`, timeouts, thinking level or other env/config values; AI
assessment from video; changes to the expert (human) chat; rate-limit code; prompt caching; Prisma `relationJoins`.

## 2. Scope

In:
- A fixed opening greeting, written per topic and stored by code when an AI conversation is created (no model call).
- A richer, personal chat context (names, gender, clinician profile, plan detail) chosen per topic.
- Prompt `chat.v3` (new, hash-pinned): uses names, writes UK English, allows plain lists, no repeated footer.
- Lists the frontend can render (a line format, no new event type).
- A faster send path (independent database reads run together).
- Live evidence (diagnose + eval scripts), and the docs the earlier chat work left unfinished.

Out: see §1.

## 3. Locked decisions (do not relitigate)

| # | Decision | Notes / status |
|---|---|---|
| 1 | **First names go to Gemini**: the child's display name and the parent's first name. Care-team (clinician, expert) names stay hidden from the model, are still scrubbed from parent text and still blocked in output. | Owner decision 2026-10-22: no real users yet, test at full strength. Supersedes 0019 §3 row 18 for those two names only. **Test data only** until launch gate G1 (paid key, data terms, `AI_ALLOW_REAL_DATA`) passes. |
| 2 | Child display name = `preferredName`, else the first word of `name`. Parent name = first word of `user.name`. | Never the full name. |
| 3 | No change to model, fallback, timeout, thinking or any other env/config value. | Owner decision: the chat works now; do not risk it. |
| 4 | **Prompt `chat.v3`** is a new file with a new pinned hash. v1 and v2 are never edited. Rules 1-3, 7 and 9 stay word for word. | Changing `<rules>` needs **clinician sign-off (launch gate G3)**: say so in the spec comment and the docs. |
| 5 | Context stays an **allow-list per topic** (§6). `observationSummary` (clinician narrative) and the parent-typed `accommodations` text are **not** sent. | Highest risk of diagnosis or medication text and prompt injection. |
| 6 | **List format on the wire**: one item per line starting `- ` (bullet) or `1. ` (step), at most 5 items, a blank line between a paragraph and the list. No bold, headers, links, emoji or HTML. No new SSE event; `delta` text carries it. | The frontend renders lines that start with `- ` or `N. `. |
| 7 | The greeting is a stored `AI` / `COMPLETE` message, fixed text per topic, **no footer**, created in the same transaction as the conversation. | Not a turn (cap counts `PARENT` only), not a strike (strikes only in `storeReply`), not model history (`buildChatRequest` already drops a leading assistant message), not summary input. |
| 8 | **Latency safety net: nothing new is added.** It already exists: the default thinking level for Gemini 3 Flash is `minimal` (code default, pinned by `thinking-options.spec.ts`); a first-token timeout (`AI_CHAT_FIRST_TOKEN_TIMEOUT_MS`, 20 s) aborts a stalled call and, only if `AI_FALLBACK_MODEL` is set, retries on that model before any text is sent; otherwise the parent gets an `error` event and retries. | `AI_FALLBACK_MODEL` is empty today. Setting it is an env change the owner decides separately; this plan does not touch it. The richer context adds input tokens: verify in the live run that time-to-first-token and `finishReason: length` do not regress. |
| 9 | **Design guard.** No new abstractions, interfaces, base classes, config knobs or helper files. Extend the existing builder, constants, prompt and service. One place per rule. Delete what the change makes dead. A plain inline `Promise.all`, not a utility. | Owner concern: scattered ifs and "reusable" functions that never got a second caller. |
| 10 | Send path: `nameGroups()`, `contexts.build()` and the history query are independent after the parent message is stored, so they run in one `Promise.all`. | Measure time-to-first-token before and after with the diagnose script. |
| 11 | Rate limits: no code. The `error` event already carries `AI_RATE_LIMITED`; the frontend handoff doc gets a code-to-friendly-message table. | |

## 4. Data model

No schema change and no migration. The greeting is an ordinary `messages` row (`sender AI`, `state COMPLETE`, `seq 1`).

## 5. Endpoints

No new route and no operationId change (so the docs-drift list in `test/docs.e2e-spec.ts` is untouched). Behaviour changes only:

| Method | Path | operationId | Auth | Notes |
|---|---|---|---|---|
| POST | `/children/{childId}/ai-conversations` | unchanged | unchanged | The new conversation already holds the greeting: `lastMessageSeq` is 1. |
| GET | `/conversations/{id}/messages` (parent) | unchanged | unchanged | First message is the greeting (`sender AI`, no footer). The parent's first message is `seq 2`. |
| POST | `/ai-conversations/{id}/messages` | unchanged | unchanged | Replies may contain `- ` / `1. ` lines. |

Update the `@ApiOperation` descriptions and the handoff doc to match.

## 6. Cross-cutting

### 6.1 Context per topic (an allow-list; the unit spec asserts the exact key set)

Every topic: `family` = parent first name, child display name, gender, age.

| Topic | Extra context |
|---|---|
| TODAYS_ACTIVITIES | today's plan day; clinician profile: strengths, sensory traits, calming preferences |
| PLAN_EXPLAINER | section titles; day titles **with instructions** (existing caps plus a total character budget); `currentStage`, `primaryCareFocus` |
| RECENT_PROGRESS | last week (days logged, average sleep); recent chat themes; strengths, `primaryCareFocus` |
| EVERYDAY_ROUTINES | today's plan day; plan overview; sensory traits, calming preferences, communication |

Source: `ChildDto` (already carried by `AiAccessService.assertCanChat`) and the existing domain services. Reuse `truncate` and `escapeTags`.

### 6.2 Names

- `send-ai-message.service.ts` `nameGroups()` keeps only the **clinician and expert** groups. The child and parent groups go away, so their
  names are neither replaced in the parent's text nor blocked in the reply.
- Emails, links, phone numbers and long digit runs are still redacted from parent text.
- The summary job keeps redacting **all four** name groups, so names never reach summaries or the summary model call.
- `smallTalkReply()` loses "I can't see names" and uses the names.

### 6.3 Prompt `chat.v3` changes against v2

- Rules 6 and 10: use the given first names naturally; never ask for other personal details (phone, address, school, ID); no "I cannot see names".
- Rules 4 and 8: short by default; when steps or options help, or the parent asks, use the §3 row 6 list format.
- New rule: write UK English. The target users are UK families; no other language is supported or tested (decision 2026-10-23).
- New rule: questions about the plan are answered from the plan in context only; say when something is not in the plan.
- Do not repeat the footer text (the app adds it).

### 6.4 Streaming

No protocol change. `shared/sentence-splitter.ts` treats a newline followed by `- ` or `N. ` as a piece boundary, so list items stream and
pass the safety filter one by one. The `MARKUP` blocklist already allows `- ` and `1. `.

### 6.5 Privacy

Child and parent first names now reach Google. Allowed for test data only; the docs say so, and launch gate G1 must pass before real families.

### 6.6 Evidence from research (2026-10-22)

| Question | Finding | Decision |
|---|---|---|
| Gemini implicit caching | On by default but needs a minimum prompt (docs disagree: 4,096 tokens on the main caching page, 1,024 on the Interactions page). Our prompt is below both. [docs](https://ai.google.dev/gemini-api/docs/caching) | No caching code. Keep order: rules, topic, context. |
| Thinking level for chat | `minimal` is positioned for chat; latency is not guaranteed. [guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-5-flash) | Already the code default; no change (§3 row 8). |
| Prisma `relationJoins` | Often faster, not always; benchmark first. [blog](https://www.prisma.io/blog/prisma-orm-now-lets-you-choose-the-best-join-strategy-preview) | Not enabled; not part of this plan. |
| Measured in this repo | `messages` has `@@unique([conversationId, seq])` (history query indexed); the send path awaits its independent reads one after another. | §3 row 10. |

## 7. Build order (ordered checklist)

Rules for every step: no commits; lint and prettier on explicit files only, never `--fix` or a directory; do not run the full e2e suite;
ask the owner for the Gemini key as a scratch file path and never print it.

### A. Opening greeting
- [x] A.1 `shared/ai-chat.constants.ts`: add `chatGreeting(topic, parentFirstName, childName)` — four fixed texts, each ends with an invitation to ask one question, no footer.
- [x] A.2 `features/create-ai-conversation/create-ai-conversation.service.ts`: in one transaction create the conversation, `lockConversation`, `appendMessage` the greeting; return the updated conversation. Load the parent's name and the child's display name.
- [x] A.3 `jobs/conversation-summary.jobs.ts`: for AI chats skip the `seq 1` AI greeting, so a chat with no parent message still gets the "no messages" summary and no model call.
- [x] A.4 Specs: `create-ai-conversation.service.spec.ts`, the summary-job spec; `test/ai-chat.e2e-spec.ts` (seq shifts by one, greeting present, not counted as a turn or strike); `@ApiOperation` text.

### B. Context, names, prompt, lists, send path
- [x] B.1 `shared/ai-chat-context.builder.ts`: `family` block and the §6.1 per-topic extras (`ChatPromptContext`, `RawChatInput`, `assembleChatContext`, `build`); update its key-set spec.
- [x] B.2 `prompts/chat.v3.ts` + `chat.v3.spec.ts`: §6.3 rules, `buildSystem` with the new context blocks; pin the hash only after C.2; point `shared/ai-chat.request.ts` at v3. v1/v2 untouched (adjust only the one v2 assertion that says v2 is the live version).
- [x] B.3 `send-ai-message.service.ts`: §6.2 `nameGroups`; `Promise.all` for names + context + history; `smallTalkReply()` wording.
- [x] B.4 `shared/sentence-splitter.ts` list boundary + splitter and reply-processor cases.
- [x] B.5 Update `pii-redaction`, `ai-chat.request` and `send-ai-message` specs for the new name behaviour.

### C. Live evidence
- [x] C.1 Update `test/ai/run-chat-eval.ts` and `test/ai/run-chat-diagnose.ts` (name groups, synthetic profile); add about 5 cases (the Hinglish one was later removed) to `test/ai/fixtures/chat-guided.json`: greeting by name, bullet request, Hinglish, plan explain, "what does day 3 mean".
- [x] C.2 (owner tests live in staging, not run here) Run `AI_DIAG_LIVE=1 AI_KEY_FILE=<scratch> AI_DIAG_MODELS=gemini-3-flash-preview AI_DIAG_VARIANTS=app AI_DIAG_SHOW=1 npm run ai:diagnose:chat` and `AI_EVAL_LIVE=1 AI_MODEL=google:gemini-3-flash-preview AI_EVAL_DELAY_MS=5000 npm run ai:eval:chat` (the preview model rate-limits at about 6 requests per minute). Read the real replies and report as evidence: length, list use, repeated footer, language, name use, plan awareness, false redirects, time-to-first-token before/after, any `finishReason: length`. Fold fixes into v3, then pin its hash.

### D. Docs
- [x] D.1 `docs/ai.md`: rules 2-3 (first names allowed, care team still hidden, G1 note); §4 protocol (headers and a leading `: hb` are sent before the provider call; provider failures are `error` events, not 503); `chat.v3`; the small-talk backstop; `AI_CHAT_FIRST_TOKEN_TIMEOUT_MS` and `AI_CHAT_THINKING_LEVEL`; list format; greeting; model-choice evidence; §6.6 findings.
- [x] D.2 `docs/plans/0019-phase-19-conversations-and-summaries.md`: note on §3 row 18 (superseded for two names by 0020); notes on §6.4 and §6.5 superseding "headers on first delta"; §14 results log: raw REST latency 60-79 s on `gemini-3.5-flash-lite`; `chunkMs` is armed only after the first stream chunk so it cannot guard time-to-first-token; thinking tokens count inside `maxOutputTokens`; `thinkingBudget: 0` is a 400 on `gemini-3.5-flash-lite`; `gemini-3.1-pro` is a 429 on this key; `gemini-3-flash-preview` median about 1.4 s and about 6 requests per minute.
- [x] D.3 `docs/frontend-handoff-chat-and-test-console.md`: drop `503 AI_UNAVAILABLE` for provider failures; the leading `: hb`; the stored greeting message; the list line format; the small-talk reply; an error-code to friendly-message table including `AI_RATE_LIMITED`.
- [x] D.4 Set this plan's status and `docs/plans/README.md` row to **Done** when B-D pass.

### Verification (explicit files only)
- `npx jest <touched specs>`: chat.v3, context builder, send-ai-message, chat-reply processor, sentence-splitter, pii-redaction, create-ai-conversation, summary jobs, ai-chat.request, thinking-options.
- `npx tsc --noEmit -p tsconfig.json`; `npx eslint <changed files>` (no `--fix`); `npx prettier --check <changed files>`.
- Only `test/ai-chat.e2e-spec.ts` (Docker Postgres), not the suite.
- The two live runs in C.2. Report results as evidence, including anything that failed.

## 8. How to resume

Paste this into a new session:

```
Read AGENTS.md, docs/ai.md and docs/plans/0020-phase-20-personal-ai-chat.md (the single source of truth for this task), then
docs/plans/0019-phase-19-conversations-and-summaries.md §3, §6.1-§6.5, §14.

Implement plan 0020, steps A to D, in one run without stopping to ask "continue". Rules: no commits; run lint/prettier on explicit files
only, never a directory and never --fix; do not run the full e2e suite (only test/ai-chat.e2e-spec.ts); do not change AI_MODEL,
AI_FALLBACK_MODEL, timeouts, thinking level or any env/config value; chat.v1 and chat.v2 are never edited (chat.v3 is new, with a new
pinned hash, and needs clinician sign-off G3: say so). Follow the design guard (§3 row 9): no new abstractions, helpers files or config
knobs. Include the send-path Promise.all (§3 row 10) and measure time-to-first-token before and after.
When you reach step C.2 ask me for the path of the Gemini key scratch file; never print the key. Report evidence (real replies, test and
timing output), not guesses, and say plainly what failed or was skipped. Keep the diff small. Tick the checklist in the plan as you go.
```

## 9. Results of the implementation run (2026-10-23)

Done and verified (explicit files only, no commits):
- `npx tsc --noEmit -p tsconfig.json`: clean. `npx eslint` on the 24 changed `.ts` files: clean. `npx prettier --check`: clean except three files that were already unformatted at HEAD (`conversation-summary.jobs.ts`, `test/ai-chat.e2e-spec.ts`, `test/ai/run-chat-eval.ts`), left as they were.
- `npx jest src/modules/conversations src/common/ai/thinking-options`: 31 suites, 340 tests pass (includes chat.v3, context builder, send-ai-message, reply processor, sentence splitter, create-ai-conversation and summary-job specs). `pii-redaction.spec.ts` needed no change: `redactPii` is unchanged, only the groups passed to it are.
- `test/ai-chat.e2e-spec.ts` against Docker Postgres: 24 of 24 pass (greeting at seq 1, seq shifts by one, not a turn, not a strike, only care-team names redacted, first names reach the model). The full e2e suite was not run. One temporary timing spec (`test/tmp-send-timing.e2e-spec.ts`) was run for the Promise.all measurement and deleted.
- `npm run ai:eval:chat` dry run: 46 cases build, 0 with a care-team name in the prompt.
- Send path (§3 row 10), local Docker database, 23 samples each: request to provider call, median 38 ms with `Promise.all`, 42 ms with the same reads awaited one after another. Not a measurable gain on a local database; the gain is the round trips on a remote one.
- Time to first text on `gemini-3-flash-preview` (`ai:diagnose:chat`, variant `app`): chat.v2 with the old context 1191, 949, 905, 1485 ms (about 690 input tokens); chat.v3 with the richer context 1114, 936, 1212, 946 ms (about 1,005 input tokens). No `finishReason: length`, no thinking tokens. The message "what should I do today" failed with a provider 503 in both runs.

Real replies read (chat.v3, first live run, synthetic family: parent Meera, child Zephyrine):
- Names work: "hi" got "Namaste Meera ... Zephyrine ke liye ... madad" (v2 had answered "I cannot see any names"). "who am I" got "Meera, aap Zephyrine ki mummy hain".
- **Language (dropped 2026-10-23):** with a Hindi child profile, English messages were answered in Hinglish. Decision: target users are UK families, so the language field, the Hinglish fixtures and the language rule were removed; rule 11 is now "Write in UK English". Not verified live.
- The melatonin question was refused, but the reply said "talk to your doctor"; the baseline said "your expert". Rule 2 is word for word from v1, so this is a model wording choice to watch in the eval.
- A numbered-list reply could not be read: see below.

NOT done:
- **C.2 is incomplete.** After about 16 live requests the key returned HTTP 429 for every request, still 15+ minutes later and on a later single request, so the full `ai:eval:chat` (46 cases) was never run live, and the reworded rule 11, the list format, Hinglish and plan-awareness cases (C68-C72) have no live evidence. A try on `gemini-2.5-flash` gave 404. The quota was not inspected (a quota or billing check is the owner's). Re-run when the key allows: `AI_EVAL_LIVE=1 AI_MODEL=google:gemini-3-flash-preview AI_EVAL_DELAY_MS=15000 npm run ai:eval:chat` and the diagnose command of C.2.
- The chat.v3 hash `ec0ce95a...7524` is pinned on the current text **before** the live eval finished, against this plan's own order. If the live run needs a rule or fragment change, re-pin it (v3 has not shipped).
- **Launch gate G3:** chat.v3 changed `<rules>` (4, 6, 8, 10 and the new 11 and 12) and the fragments of TODAYS_ACTIVITIES, PLAN_EXPLAINER and EVERYDAY_ROUTINES. It needs clinician sign-off before real families. First names reach Google: test data only until G1.
- D.4 done on 2026-10-23 at the owner's request: live checks (C.2) and clinician sign-off (G3) for chat.v3 happen in staging before real families; G1 is still required.
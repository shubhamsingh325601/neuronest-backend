# AI Conventions

**Target users: families in the UK.** The assistant writes UK English. Other languages are out of scope; do not add language detection, translation, or language-specific prompts, tests or fixtures.

Stable rules for every AI feature in the backend: the parent coaching tip (plan 0018), the guided AI chat and the
conversation summaries (plan 0019) and the personal chat (plan 0020). Decisions and history live in `docs/plans/0018-...`, `docs/plans/0019-...` and `docs/plans/0020-...`;
this file holds only what a contributor must follow when touching AI code.

---

## 1. Layout

| Where | What |
|---|---|
| `src/common/ai/` | The only place that imports the AI SDK (`ai`, `@ai-sdk/*`). `AiService` is the port (`generateStructured`, `streamChat`); `VercelAiService` implements it; model factory, fallback, run recorder, budgets, price table. |
| `src/modules/ai-coaching/` | Parent coaching tip: context builder, prompts `coaching-tip.vN`, safety filter, generator, job. Also holds the shared text-safety helpers (`scrubName`, `escapeTags`). |
| `src/modules/conversations/` | Guided AI chat (`send-ai-message`, topics, `chat.v1` prompt, reply processor, sentence splitter), human chat, summaries, retention jobs. |
| `test/helpers/fake-ai.service.ts` | `FakeAiService`: scripted output and scripted stream parts. All unit and e2e tests use it. No test calls a provider. |
| `test/ai/` | Live evals and fixtures (manual, synthetic data only). |

Domain modules never import the SDK. Swapping Gemini, Anthropic or OpenAI is configuration (`AI_PROVIDER`, model keys).

## 2. Rules that bind every AI feature

1. **No raw text outside `messages.body`.** `ai_runs` stores metadata only (capability, prompt id/version, provider, model,
   status, error class, token counts, latency, cost). Never log or store a prompt, a reply, a message or an SDK error
   object: the SDK error carries the request body. Always pass `onError` to `streamText` that keeps only the error class
   and HTTP status.
2. **Context is an allow-list.** A builder calls the existing domain services with the real caller (never their tables,
   never Prisma of another domain) and copies only the fields the feature may use. Never: full names, date of birth, ids,
   clinician or plan notes (`observationSummary`), call logs, media, parent notes (`accommodations`), message text. A unit
   test asserts the exact key set. The one exception (plan 0020): the guided chat context carries the **child's display
   name** (`preferredName`, else the first word of `name`), the **parent's first name**, gender, and the
   clinician's profile (strengths, sensory traits, calming preferences, communication, stage, care focus), chosen per topic.
3. **Names are scrubbed before the model sees text** (`scrubName`) and checked on the way out (`containsName`).
   Parent free text goes through `redactPii()` (emails, URLs, phones including Indian formats, long digit runs, known names).
   In the guided chat only the **care team** (clinician and expert names) is hidden, scrubbed from parent text and blocked in
   the reply; the child's and the parent's first names are sent to the model on purpose (plan 0020 section 3 row 1).
   Coaching tips and summaries still hide every name. **First names reach Google: test data only until launch gate G1
   (paid key, data terms, `AI_ALLOW_REAL_DATA`) has passed.**
4. **Output is validated before anyone sees it:** Zod schema, then a deterministic post-check (blocklist for diagnosis,
   medication, promises, links/markup, name leaks, persona breaches). A reject is `AI_INVALID_OUTPUT`; the fallback model
   is tried, then the request fails closed. For chat, the check runs per sentence before it is sent (retract on a hit).
5. **Persona and disclosure are constants in code**, not model behaviour: the AI is an assistant, never a clinician or
   expert, never diagnoses, never advises on medication; the footer is appended by code.
6. **No tools, no web, no URL fetch, no agent loops.** One model call per user action (plus the fallback before the first output).
7. **Prompts are versioned and hash-pinned.** Any change to a prompt's `system` text is a new `vN` module and a new row in
   the `SHIPPED` table of the prompt spec; never edit a shipped version. Changing `<rules>` or persona text needs
   clinician sign-off (launch gate G3).
8. **Dark by default.** `AI_ENABLED=false` ships the code inert. `AiAccessService` is the single choke point for the flag,
   role and ownership. ADMIN holds AI permissions through the permission spread and is refused in the service.
9. **Free tier means synthetic data only.** `AI_ALLOW_REAL_DATA` and a paid key are launch gates; boot fails otherwise in production.

## 3. Coaching tip

Cached per child and day in `ai_outputs`; regenerated at most twice a day when the `inputHash` (context + prompt version)
changes. Context: age, today's plan day, last week's days logged and sleep average, up to 3 clinician tips, and (prompt v3)
`recentChats`: the fixed-taxonomy themes and the follow-up flag of the child's latest READY conversation summaries, read through
`RecentSummaryThemesReader`. Summary text is never passed on. Prompt rules 11 and 12 forbid mentioning chats and allow the
themes only to order the clinician's steps.

## 4. Guided AI chat

- Topics are the code constant `AI_CHAT_TOPICS` (`AiChatTopic` enum for stored ones); each topic fixes its prompt fragment and
  its context allow-list. The "AI assessment" topic is `UNAVAILABLE` and the server refuses it.
- Off-topic control is layered and best-effort: topic prompt, the `[[OFF_TOPIC]]` marker (prefix rule on the streamed start),
  a fixed redirect, strike limit (`AI_CHAT_OFF_TOPIC_LIMIT`), length / daily / per-chat / output caps. The deterministic
  controls are the caps, the strike limit and the absence of tools.
- Prompt `chat.v3` (plan 0020) is the live version: it uses the child's and the parent's first names, answers in the
  UK English, allows short plain lists, answers plan questions
  from the plan in context only, and does not repeat the footer. `chat.v1` and `chat.v2` stay in the repo as shipped
  history and are never edited. **v3 changed `<rules>` and has not had clinician sign-off (launch gate G3).**
- Context per topic (an allow-list; `ai-chat-context.builder.spec.ts` asserts the key sets). Every topic: `family`
  (parent first name, child display name, gender) and age. TODAYS_ACTIVITIES adds today's plan day, strengths,
  sensory traits, calming preferences. PLAN_EXPLAINER adds section titles, day titles with instructions (1500 characters
  per day, 8000 in total) and current stage and care focus. RECENT_PROGRESS adds last week, recent chat themes, strengths,
  care focus. EVERYDAY_ROUTINES adds today's plan day, plan titles, sensory traits, calming preferences, communication.
  The clinician's `observationSummary` and the parent-typed `accommodations` are never sent.
- **Opening greeting.** Creating an AI chat stores a fixed greeting per topic (`chatGreeting`), by name, as `seq 1`
  (`AI`, `COMPLETE`, no footer, no model call) in the same transaction. It is not a turn (the cap counts `PARENT` only),
  not a strike, not model history (a leading assistant message is dropped) and not summary input (the summary job skips
  `seq 1` of an AI chat, so a chat with no parent message still gets the "no messages" summary).
- **List format.** A reply may hold list lines: `- ` (options) or `1. ` (steps), at most 5, a blank line before the list; no
  bold, headers, links or emoji. There is no new event: `delta` text carries the lines. The sentence splitter treats a
  line break before a list line as a piece boundary, so each item streams and passes the safety filter on its own.
- Stream protocol (POST `/ai-conversations/{id}/messages`, `text/event-stream`): `delta {text}`, `retract {text}`,
  `done {messageId, seq, state, conversationClosed}`, `error {code}`. Everything that can be refused is refused as an
  ordinary problem response first. Then the headers and a `: hb` heartbeat comment are sent **before the provider is
  called** (so the client can show a typing state; the provider can be slow), and from then on the service never throws:
  every provider failure is an `error` event, not a `503`. The first-token timeout `AI_CHAT_FIRST_TOKEN_TIMEOUT_MS`
  (default 20 s) aborts a call that stalls before its first text and, only if `AI_FALLBACK_MODEL` is set, retries on that
  model before any text is sent; otherwise the parent gets an `error` and retries. `AI_CHAT_THINKING_LEVEL` overrides
  the thinking level; the code default for Gemini 3 Flash is `minimal` (`thinking-options.spec.ts` pins it).
- **Small-talk backstop.** If the model marks a bare greeting, thanks or "who am I" (`isSmallTalk`) as off-topic anyway, the
  parent gets the fixed `smallTalkReply` (by first name) and no strike.
- Reply outcome: `finishReason 'stop'` or a trimmed `'length'` is COMPLETE; `'other'`, a thrown loop, an `error` part or a
  foreign abort is a failure; a filter hit is RETRACTED (fixed safe constant); an off-topic reply is REDIRECTED.
  A client disconnect aborts the provider call and records `CLIENT_ABORTED` with null tokens.

## 5. Conversation summaries

A closed conversation (participant close, idle 24 h, or the off-topic strike limit) queues `conversation.summarise` (system
actor, `dedupeKey summary:{id}`). The input is name-scrubbed and PII-redacted; the output is an allow-listed JSON shape
(`overview`, `themes` from a fixed taxonomy, `parentConcerns`, `guidanceGiven`, `openQuestions`, `followUpSuggested`;
`participantsKind` is set by code). `checkSummary` rejects names, contact details, links, markup, diagnosis-as-fact, exact
age or date, and copied runs of more than 8 words. Medication words are deliberately allowed in a summary (it reports what
was discussed). After the summary is READY and the chat has been closed `CONVERSATION_PURGE_IDLE_DAYS`, `conversation.purge`
hard-deletes the `messages` rows; at `CONVERSATION_PURGE_BACKSTOP_DAYS` a PLACEHOLDER summary is written and the purge runs anyway.

## 6. Evals and tests

| Command | What it does |
|---|---|
| `npm test` | Unit and contract specs with `FakeAiService`: prompt hashes, context key sets, filters, splitter, reply processor, purge clock. |
| `npm run test:e2e` | Chat, summary, purge and event-stream flows against Postgres with the fake AI. |
| `npm run ai:eval` | Live coaching-tip eval (needs `AI_EVAL_LIVE=1` and a key; synthetic data only). |
| `npm run ai:eval:summary`, `npm run ai:eval:chat` | Live summary and chat evals. They measure how often the model holds; they do not gate CI. |
| `npm run ai:smoke:chat` | One live end-to-end chat against the local database (`AI_SMOKE_LIVE=1`). |
| `npm run ai:diagnose:chat` | Timing probe against the real provider (`AI_DIAG_LIVE=1`): time to first text, gaps, tokens, finish reason. |

## 7. Known limits

- The off-topic marker is a model decision and can be fooled; the live chat eval measures it.
- Backups and the provider's own retention keep text after the purge (launch-gate items).
- One backend instance: the chat busy-lock, the event bus and the stream caps are in-process (the bus is an abstract seam for Postgres LISTEN/NOTIFY).
- With `AI_ENABLED=false`, a closed chat's summary job fails three times and goes DEAD (open item in plan 0019).

## 8. Model choice and latency evidence (plan 0020 section 6.6)

- The chat model is `google:gemini-3-flash-preview` with the code-default thinking level `minimal`. Measured with
  `ai:diagnose:chat`: about 1 s to the first text, about 0.7-1.0 k input tokens, no thinking tokens and no
  `finishReason: length` in any completed call, with the old and with the richer (chat.v3) context. The richer context adds
  about 45 % input tokens and no measurable first-token time. Its free-tier limit is low (about 6 requests per minute, and a
  daily quota that returned 429 during plan 0020's runs), so live evals must be spaced (`AI_EVAL_DELAY_MS`).
- Gemini implicit caching needs a minimum prompt size (the docs disagree: 4,096 or 1,024 tokens); the chat prompt is below
  both, so there is no caching code. Keep the order rules, topic, context so it can apply later.
- Prisma `relationJoins` are not enabled (benchmark first). The send path reads names, context and history together with
  one `Promise.all`; on the local Docker database the time from request to provider call was a median of 38 ms against 42 ms
  when the same reads ran one after another (23 samples each), i.e. not measurable locally. The gain is the round trips on a remote database.
- Older findings (raw REST latency, `chunkMs`, thinking tokens inside the output limit, `thinkingBudget: 0` being a 400,
  `gemini-3.1-pro` returning 429) are in plan 0019 section 14.

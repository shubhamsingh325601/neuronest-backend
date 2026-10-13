# AI Conventions

Stable rules for every AI feature in the backend: the parent coaching tip (plan 0018), the guided AI chat and the
conversation summaries (plan 0019). Decisions and history live in `docs/plans/0018-...` and `docs/plans/0019-...`;
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
   never Prisma of another domain) and copies only the fields the feature may use. Never: names, date of birth, ids,
   clinician or plan notes, call logs, media, parent notes, message text. A unit test asserts the exact key set.
3. **Names are scrubbed before the model sees text** (`scrubName`) and checked on the way out (`containsName`).
   Parent free text goes through `redactPii()` (emails, URLs, phones including Indian formats, long digit runs, known names).
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
- Stream protocol (POST `/ai-conversations/{id}/messages`, `text/event-stream`): `delta {text}`, `retract {text}`,
  `done {messageId, seq, state, conversationClosed}`, `error {code}`. Headers are flushed on the first provider delta; a failure
  before that is an ordinary problem response (`503 AI_UNAVAILABLE`). After the headers the service never throws.
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

## 7. Known limits

- The off-topic marker is a model decision and can be fooled; the live chat eval measures it.
- Backups and the provider's own retention keep text after the purge (launch-gate items).
- One backend instance: the chat busy-lock, the event bus and the stream caps are in-process (the bus is an abstract seam for Postgres LISTEN/NOTIFY).
- With `AI_ENABLED=false`, a closed chat's summary job fails three times and goes DEAD (open item in plan 0019).

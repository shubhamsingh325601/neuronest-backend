# Frontend handoff: AI chat, expert chat, and the admin "act as parent" test console

Paste the block under "THE PROMPT" into the agent that works on the frontend. Everything in it was checked
against the backend code on the `dev` branch (plan 0019, batches 5 and 6, plus the temporary impersonation
endpoint). The OpenAPI document at `/openapi.json` (reference UI at `/docs`) is the contract of record; where this
text and the OpenAPI document disagree, the OpenAPI document wins and the backend owner should be told.

---

## THE PROMPT

You are building frontend code against the NeuroNest backend (NestJS, REST + server-sent events, base path
`/v1`). There are two jobs.

**Job 1: the admin site gets a temporary "Parent test console".** There is no parent app build yet, so the owner
tests the parent features from the admin site by acting as a parent. This is a testing aid and will be deleted: put
it behind one feature flag and one folder so it can be removed in one commit.

**Job 2: map the real parent app and expert app correctly.** The console exercises the same calls the real apps
will make, so build the API layer once (a small typed client + a stream reader) and let the console and the apps
share it.

### 0. Rules that apply to everything

- Never log, store, or display tokens or message text outside the screen that shows the conversation. No
  `console.log` of a request body, reply, or `Authorization` header. No message text in analytics or error reports.
- Hold the impersonation token in memory only (a variable or store), never in `localStorage`, cookies, or the URL.
- Errors are RFC 9457 `application/problem+json`: `{ type, title, status, detail, code, requestId, timestamp }`.
  Branch on `code` (stable), never on `detail` text.
- All timestamps are ISO-8601 strings. `seq` is an integer starting at 1 per conversation.
- Browser `EventSource` cannot send an `Authorization` header, so **do not use it**. Use `fetch` and read
  `response.body` as a stream (in React Native use `expo/fetch`, which supports streaming). Write one SSE parser
  and reuse it for both streams below.

### 1. Getting a parent token (admin site only)

1. The admin signs in normally (`POST /v1/auth/login`) and holds an admin access token.
2. List parents: `GET /v1/users?role=PARENT&limit=...` (cursor paginated; send the admin token).
3. `POST /v1/users/{parentId}/impersonate` (admin token, no body) returns
   `{ accessToken, expiresIn, user: { id, name, email, role }, impersonatedBy }`.
   - `expiresIn` is in seconds (default 3600). There is **no refresh token**: when a call returns `401` with code
     `INVALID_TOKEN`, ask the admin to press "Act as this parent" again.
   - `404 IMPERSONATION_DISABLED`: the server has the feature off. Hide the console and say so.
   - `422 IMPERSONATION_TARGET_NOT_ALLOWED` (not a parent), `409 ACCOUNT_NOT_ACTIVE`, `404 USER_NOT_FOUND`.
4. Use `Authorization: Bearer <impersonation token>` for **every parent call below**. The token behaves as the parent.
   Two things are refused while acting as a parent: changing the password and deactivating the account
   (`403 IMPERSONATION_RESTRICTED`). Hide those buttons in the console.
5. Always show a persistent banner: "Acting as <name> (<email>). Expires in mm:ss. [Exit]". Exit just drops the token.
   Everything the admin sends is stored as the parent's own message (`sender = PARENT`); it is real data on that
   (test) account, so use test parents.

### 2. AI chat (parent) and how to map it

Endpoints, all with the parent token:

| Call | Notes |
|---|---|
| `GET /v1/ai-chat/topics` | `{ version, data: [{ id, label, description, kind }] }`. `kind` is `AI` (open a chat with `id`), `ROUTE` (`BOOK_CALL`, `TALK_TO_EXPERT`: open another screen, not a chat) or `UNAVAILABLE` (`AI_ASSESSMENT`: show "coming soon"). Never hard-code the list; render what the server returns. |
| `GET /v1/children` | The parent's children. A chat belongs to one child. |
| `POST /v1/children/{childId}/ai-conversations` | Body `{ topic }` (an `id` whose kind is `AI`). `201` returns the conversation `{ id, kind:'AI', topic, childId, status:'OPEN', ... }`. `422 AI_TOPIC_NOT_A_CHAT` / `AI_TOPIC_UNAVAILABLE` for the other kinds. |
| `POST /v1/ai-conversations/{id}/messages` | Body `{ text, clientMessageId }`. **Response is a stream** (see below). |
| `GET /v1/conversations/{id}/messages?afterSeq=&limit=` | Works for AI chats too (read the history). `{ purged, items: Message[] }`, oldest first, `limit` 1..100 (default 50). After the retention purge: `{ purged: true, items: [] }`. |
| `POST /v1/conversations/{id}/close` | The parent can close an AI chat. Idempotent. |
| `GET /v1/children/{childId}/conversations` | Metadata list (kind, topic, status, `summaryStatus`), never message text. |
| `GET /v1/conversations/{id}/summary`, `GET /v1/children/{childId}/conversation-summaries` | Summary of a closed chat (`summaryStatus` PENDING until the job has run). |

`Message` is `{ id, seq, sender: 'PARENT'|'EXPERT'|'AI', state: 'COMPLETE'|'RETRACTED'|'REDIRECTED', body, clientMessageId|null, createdAt }`.

**The send stream.** Send the POST with `Accept: text/event-stream`, read the body as a stream, split on a blank
line. Each block is `event: <name>` + `data: <json>`. A block starting with `:` is a heartbeat comment (ignore it,
but it proves the connection is alive; one is sent every 15 s). Events:

- `delta` `{ text }`: **append** `text` to the AI bubble. Text arrives sentence by sentence (not word by word) because
  each sentence is safety-checked before it is sent. The last `delta` of a normal reply is a fixed "This is AI
  guidance, not a diagnosis..." footer; show it as part of the reply.
- `retract` `{ text }`: **replace everything shown in this bubble** with `text` (the reply failed a safety check
  after part of it was already shown). Treat it as final; the `done` event follows.
- `done` `{ messageId, seq, state, conversationClosed }`: the reply is stored. `state` is `COMPLETE`, `REDIRECTED`
  (the question was off-topic; the reply is a fixed "I can only help with..." text) or `RETRACTED`. If
  `conversationClosed` is true (the third off-topic reply closes the chat) disable the input and offer "pick a topic".
- `error` `{ code }`: the stream failed after it started. Codes: `AI_FAILED`, `AI_TIMEOUT`, `AI_PROVIDER`,
  `AI_RATE_LIMITED`, `AI_BUDGET`, `AI_INVALID_OUTPUT`, `AI_BLOCKED`, `CONVERSATION_CLOSED` (the chat was closed while
  the reply was being written). The partial text on screen was **not stored**; mark the bubble as failed and offer
  "try again" with the **same** `clientMessageId` (the server then regenerates without storing the parent message twice).

Problems that arrive **before** the stream starts are ordinary JSON errors with an HTTP status (no events):
`400` validation, `403` (not this parent's chat, or an admin token), `404`, `409 CONVERSATION_CLOSED`,
`409 AI_CHAT_OFF_TOPIC_LIMIT` (chat closed after three off-topic messages), `409 AI_CHAT_BUSY` (a reply is already being
written for this chat: wait), `409 AI_CHAT_REPLY_UNAVAILABLE`, `409 CLIENT_MESSAGE_ID_IN_USE`, `422 MESSAGE_TOO_LONG`
(server limit is lower than the 2000-char schema maximum; default 1000), `422 NOT_AN_AI_CONVERSATION`,
`429 AI_CHAT_LIMIT_REACHED` (daily or per-chat message cap), `503 AI_DISABLED`, `503 AI_UNAVAILABLE`.

Rules for `clientMessageId`: generate a new UUID per user message; reuse it only to retry that same message. Sending
the same id again after a stored reply replays that reply as `delta`/`retract` + `done`.

Leaving mid-stream: aborting the `fetch` (an `AbortController`) cancels the provider call on the server and stores no
answer. The parent message stays stored. This is a supported action, so give the console an "Abort mid-stream" button.

### 3. The AI test panel (admin console) and what it must measure

For each message sent, record and display (a table plus a "copy as CSV" button):

- `ttfb`: ms from `fetch` start to the response headers (headers are sent when the first text is ready, so this is
  also close to the time of the first delta).
- `firstDelta`: ms to the first `delta` event.
- `total`: ms to the `done` (or `error`) event.
- number of `delta` events and of network chunks (many events in one chunk = a proxy is buffering; flag it).
- the largest gap between chunks (a gap over 15 s without a heartbeat comment = a proxy is dropping the stream; flag it).
- final `done.state`, `conversationClosed`, any `error.code`, the HTTP status of the POST, and the `requestId` from
  any problem response.
- a toggle "abort after first delta" to test client abort, and a "resend same clientMessageId" button to test
  idempotency.

Only timings, counts, event names and codes go in the log table; **not** the message text (show the text in the chat
bubbles only).

### 4. Chat with an expert (parent <-> expert), live

A parent starts a chat with the child's assigned expert; both sides then send messages and each sees the other's
messages live. Postgres is the source of truth: the live stream is an accelerator and the cursor read is the fallback.

Setup the owner does once in the admin site (these endpoints exist): create an expert
(`POST /v1/experts` `{ name, email, password }`, ADMIN), assign children (`PUT /v1/experts/{id}/children`
`{ childIds: [...] }`). The expert signs in with a normal `POST /v1/auth/login` (a real expert account, not
impersonation: impersonation is parent-only).

| Call | Who | Notes |
|---|---|---|
| `POST /v1/children/{childId}/conversations` | parent | No body. `201` returns the conversation. `409 NO_EXPERT_ASSIGNED` if the child has no expert. |
| `POST /v1/conversations/{id}/messages` | parent or the expert | Body `{ text (1..2000), clientMessageId }`. `201` returns the `Message`. Repeating a `clientMessageId` returns the stored message (no duplicate). `409 CONVERSATION_CLOSED` after close. `422 NOT_A_HUMAN_CONVERSATION` for an AI chat. |
| `GET /v1/conversations/{id}/messages?afterSeq=&limit=` | either | The catch-up read. |
| `POST /v1/conversations/{id}/close` | either | Idempotent. Triggers the summary. |
| **`GET /v1/conversations/{id}/events`** | either | **Server-sent events.** See below. |

Anyone who is not the parent or the conversation's (still assigned) expert gets `403`, an admin included (admin never
reads raw chat). An AI chat on the events route gives `422 NOT_A_HUMAN_CONVERSATION`.

**The events stream.** `GET` with the participant's bearer token and `Accept: text/event-stream`. To resume, send the
header `Last-Event-ID: <seq of the last message you have>` (a missing or invalid value means "from the start").
Each SSE block has an `id:` line: for a `message` it is that message's `seq`.

- `message`: data is exactly the `Message` object that `GET .../messages` returns (same fields). `id` = `seq`.
- `resync` `{ lastSeq }`: you were away for more than 100 messages. Do `GET .../messages?afterSeq=<your last seq>` in
  pages of 100 until you reach `lastSeq`. The stream stays open and continues with messages after `lastSeq`.
- `closed`: data is the conversation object (`status: 'CLOSED'`). The stream ends after it. Disable the input; the
  summary appears later via the summary endpoints.
- `purged`: the messages were deleted by the retention job; data is the conversation object; the stream ends. Show
  the summary only.
- `: hb` comment every 15 s: a heartbeat (ignore the content).
- The server ends the stream by itself on `closed`/`purged`, or if the person's access was removed (an expert was
  unassigned, an account was deactivated). The next connect then returns `403`.

Client algorithm (implement exactly this, it is what makes delivery gapless):

1. Load history with `GET .../messages` (follow pages until fewer than `limit` items return). Keep `lastSeq`.
2. Open the events stream with `Last-Event-ID: lastSeq`.
3. For each `message`: **ignore it if `seq <= lastSeq`**, otherwise append it and set `lastSeq = seq`. (Your own sent
   message also comes back on your stream; this rule removes the duplicate. When you POST a message, you may add the
   returned `Message` immediately and set `lastSeq` if it is higher.)
4. On disconnect (network error, or the stream ended without `closed`/`purged`): wait with backoff (1 s, 2 s, 4 s, max
   30 s, add jitter), then reconnect with the current `lastSeq`. Stop reconnecting on `401`, `403`, `404`, `422`.
   On `429 TOO_MANY_STREAMS` (the server allows 5 open streams per user and 4 per conversation) wait longer and make
   sure you close old streams (abort the `fetch`) when a screen is left.
5. On `closed`/`purged`, stop. Close the stream when the screen unmounts.
6. If the app returns from background, simply run step 4 (a reconnect replays whatever was missed).

Optimistic sending: show the message as "sending" with its `clientMessageId`; on `201` mark it sent; on a network
failure retry with the **same** `clientMessageId`.

### 5. The expert test panel (admin console)

Two side-by-side panes: **Parent** (impersonation token) and **Expert** (a separate expert login; ask for the
expert's email/password, keep the token in memory). Each pane shows its own message list and its own events
connection status (connected / reconnecting / ended), the last event id, the number of heartbeats seen, and a log of
event names with the time each arrived (no text). Buttons: send as parent, send as expert, close chat, disconnect
a pane's stream and reconnect it (to test resume), "send 5 while disconnected, then reconnect" (to test replay), and
"open a second stream for the same user" (to see the per-user cap).

### 6. CORS and deployment notes

- The backend only answers cross-origin browser calls from origins listed in its `CORS_ORIGINS` env var. The admin
  site's origin must be added there (tell the backend owner the exact origin: `scheme://host[:port]`, no trailing slash).
- SSE through some proxies/hosts is buffered. If events arrive in clumps after a long delay (see the chunk metric in
  section 3), report the host; do not work around it in the client.
- Every long-lived stream needs the `fetch` aborted on unmount, otherwise the user's stream slots (5) fill up.

### 7. Deliverables

1. A typed API client generated from `/openapi.json` (or hand-written types matching it) for the calls above.
2. One reusable SSE reader (`fetch` + `ReadableStream` + `TextDecoder`, handles chunks that split a block, `\r\n`,
   comment lines, multi-line `data:`), with unit tests for those splits.
3. The admin "Parent test console" (feature-flagged, one folder): parent picker, banner, AI test panel with the metrics
   in section 3, expert test panel from section 5.
4. A short note listing any place where the backend behaved differently from this document.

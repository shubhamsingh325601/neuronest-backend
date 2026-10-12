import type { ZodType } from 'zod';

/**
 * Provider-agnostic structured-generation contract (plan 0018). Injected by this abstract class
 * as the DI token; bound to `VercelAiService` in production and to an in-memory fake in tests.
 * Domain code imports this port and `zod` only - never `ai` or `@ai-sdk/*`.
 */
export abstract class AiService {
  abstract generateStructured<T>(req: AiStructuredRequest<T>): Promise<AiStructuredResult<T>>;
  /** Streaming, tool-free chat reply (plan 0019 section 6.5). Nothing is sent until `events` is read. */
  abstract streamChat(req: AiChatRequest): AiChatRun;
}

export interface AiStructuredRequest<T> {
  /** Capability name, e.g. `coaching-tip`. Recorded on every run. */
  capability: string;
  /** Versioned prompt identity, recorded on every run (never the prompt text). */
  prompt: { id: string; version: number };
  system: string;
  /** Already minimised and tag-escaped by the caller. */
  user: string;
  schema: ZodType<T>;
  /** Semantic/safety checks on a schema-valid output. A rejection counts as INVALID_OUTPUT. */
  postCheck?: (output: T) => 'ok' | { reject: string };
  /** Who the spend is attributed to. Metadata only. `userId` is left out for system jobs (no requester). */
  actor: { userId?: string; childId?: string };
  maxOutputTokens?: number;
}

export interface AiStructuredResult<T> {
  output: T;
  provider: string;
  model: string;
  /** 1 = primary, 2 = fallback. */
  attempt: number;
}

export interface AiChatRequest {
  /** Capability name, e.g. `chat-reply`. Recorded on every run. */
  capability: string;
  /** Versioned prompt identity, recorded on every run (never the prompt text). */
  prompt: { id: string; version: number };
  system: string;
  /** Already redacted by the caller; oldest first, ending with the parent's message. */
  messages: { role: 'user' | 'assistant'; content: string }[];
  actor: { userId?: string; childId?: string };
  maxOutputTokens?: number;
  /** Fires when the client leaves: the provider call is cancelled and the run is recorded CLIENT_ABORTED. */
  signal: AbortSignal;
}

export type AiChatEvent =
  | { type: 'delta'; text: string }
  /** The provider ended the reply on its own; `length` means it stopped at `maxOutputTokens`. */
  | { type: 'end'; finishReason: 'stop' | 'length' };

/** How the caller judged a reply the provider finished, or why it stopped reading. */
export type AiChatOutcome = 'COMPLETE' | 'BLOCKED' | 'INVALID_OUTPUT';

export interface AiChatRun {
  /**
   * Text in order, then one `end`. Throws an {@link AiRunError} when the call fails (the run is already
   * recorded). Ends quietly, with no `end`, when `signal` fired. A fallback model is only tried before
   * the first delta.
   */
  events: AsyncIterable<AiChatEvent>;
  /**
   * Always call once reading is over. Records the run with the caller's verdict and cancels the provider
   * call if it is still open. A no-op for a run that failed or was aborted (already recorded).
   */
  finish(outcome: AiChatOutcome): Promise<void>;
}

export type AiRunErrorCode =
  | 'AI_DISABLED'
  | 'AI_BUDGET'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER'
  | 'AI_INVALID_OUTPUT'
  | 'AI_BLOCKED';

/**
 * The only error type that leaves the AI layer. It carries a stable code and, at most, the
 * provider HTTP status and error class name - never an SDK error object, a prompt, or model
 * text (plan 0018 Q6.7). The message is derived from the code, so it is safe to log, persist in
 * `Job.lastError`, and send to Sentry.
 */
export class AiRunError extends Error {
  readonly code: AiRunErrorCode;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly httpStatus?: number;
  readonly errorClass?: string;

  constructor(
    code: AiRunErrorCode,
    opts: {
      retryable?: boolean;
      provider?: string;
      model?: string;
      httpStatus?: number;
      errorClass?: string;
    } = {},
  ) {
    super(`AI run failed: ${code}`);
    this.name = 'AiRunError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.provider = opts.provider;
    this.model = opts.model;
    this.httpStatus = opts.httpStatus;
    this.errorClass = opts.errorClass;
  }
}

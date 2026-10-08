import type { ZodType } from 'zod';

/**
 * Provider-agnostic structured-generation contract (plan 0018). Injected by this abstract class
 * as the DI token; bound to `VercelAiService` in production and to an in-memory fake in tests.
 * Domain code imports this port and `zod` only - never `ai` or `@ai-sdk/*`.
 */
export abstract class AiService {
  abstract generateStructured<T>(req: AiStructuredRequest<T>): Promise<AiStructuredResult<T>>;
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
  /** Who the spend is attributed to. Metadata only. */
  actor: { userId: string; childId?: string };
  maxOutputTokens?: number;
}

export interface AiStructuredResult<T> {
  output: T;
  provider: string;
  model: string;
  /** 1 = primary, 2 = fallback. */
  attempt: number;
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

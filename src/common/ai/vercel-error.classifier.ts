import { APICallError, NoObjectGeneratedError } from 'ai';
import { AiRunStatus } from '@prisma/client';
import type { AiRunErrorCode } from './ai.service';

export interface ClassifiedFailure {
  status: AiRunStatus;
  code: AiRunErrorCode;
  retryable: boolean;
  httpStatus?: number;
  /** Class name only - never the SDK message, which can carry request or response bodies. */
  errorClass: string;
  inputTokens?: number;
  outputTokens?: number;
}

export const STATUS_TO_CODE: Record<
  Exclude<AiRunStatus, 'SUCCEEDED' | 'REJECTED_BUDGET'>,
  AiRunErrorCode
> = {
  INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
  BLOCKED: 'AI_BLOCKED',
  RATE_LIMITED: 'AI_RATE_LIMITED',
  TIMEOUT: 'AI_TIMEOUT',
  PROVIDER_ERROR: 'AI_PROVIDER',
};

/** Structural on purpose: `AbortSignal.timeout` raises a DOMException, which is not always `instanceof Error`. */
function errorName(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function isTimeoutName(name: string | undefined): boolean {
  return name === 'TimeoutError' || name === 'AbortError';
}

function isTimeout(err: unknown): boolean {
  if (isTimeoutName(errorName(err))) return true;
  const cause =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return isTimeoutName(errorName(cause));
}

/**
 * Maps whatever the SDK threw to our failure taxonomy (plan 0018 Q9.3). This is the boundary
 * where SDK error objects stop existing: `APICallError` carries our prompt in
 * `requestBodyValues` and `NoObjectGeneratedError` carries the model text, so only the class
 * name, HTTP status and token counts are read from them.
 */
export function classifyFailure(err: unknown): ClassifiedFailure {
  if (NoObjectGeneratedError.isInstance(err)) {
    const blocked = err.finishReason === 'content-filter';
    return {
      status: blocked ? AiRunStatus.BLOCKED : AiRunStatus.INVALID_OUTPUT,
      code: blocked ? 'AI_BLOCKED' : 'AI_INVALID_OUTPUT',
      retryable: false,
      errorClass: 'NoObjectGeneratedError',
      inputTokens: err.usage?.inputTokens,
      outputTokens: err.usage?.outputTokens,
    };
  }
  if (APICallError.isInstance(err)) {
    if (err.statusCode === 429) {
      return {
        status: AiRunStatus.RATE_LIMITED,
        code: 'AI_RATE_LIMITED',
        retryable: true,
        httpStatus: 429,
        errorClass: 'APICallError',
      };
    }
    return {
      status: AiRunStatus.PROVIDER_ERROR,
      code: 'AI_PROVIDER',
      retryable: err.isRetryable,
      httpStatus: err.statusCode,
      errorClass: 'APICallError',
    };
  }
  if (isTimeout(err)) {
    return {
      status: AiRunStatus.TIMEOUT,
      code: 'AI_TIMEOUT',
      retryable: true,
      errorClass: errorName(err) ?? 'TimeoutError',
    };
  }
  return {
    status: AiRunStatus.PROVIDER_ERROR,
    code: 'AI_PROVIDER',
    retryable: false,
    errorClass: errorName(err) ?? 'UnknownError',
  };
}

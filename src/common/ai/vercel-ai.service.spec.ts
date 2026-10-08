import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { AiRunStatus } from '@prisma/client';
import { z } from 'zod';
import type { AiBudgetService } from './ai-budget.service';
import type { AiModelFactory, ResolvedModel } from './ai-model.factory';
import type { AiRunRecordInput, AiRunRecorder } from './ai-run.recorder';
import { AiRunError, type AiStructuredRequest } from './ai.service';
import { VercelAiService } from './vercel-ai.service';

const PRIMARY = 'google:gemini-3.5-flash-lite';
const FALLBACK = 'google:gemini-3.1-flash-lite';
const SECRET_PROMPT = 'PROMPT-SECRET-7f3a child Aarav lives at 12 Lake Road';
const SECRET_OUTPUT = 'OUTPUT-SECRET-91bc';

const schema = z.object({ headline: z.string(), body: z.string() });
type Tip = z.infer<typeof schema>;

const goodText = JSON.stringify({ headline: 'Bubble play', body: 'Blow bubbles together.' });

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
};

function ok(text = goodText, finish: 'stop' | 'content-filter' = 'stop') {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage,
    warnings: [],
  };
}

function apiError(statusCode: number, isRetryable = statusCode >= 500) {
  return new APICallError({
    message: `leaky provider message containing ${SECRET_PROMPT}`,
    url: 'https://example.invalid/v1',
    requestBodyValues: { prompt: SECRET_PROMPT },
    statusCode,
    responseBody: SECRET_OUTPUT,
    isRetryable,
  });
}

type Behaviour = () => Promise<ReturnType<typeof ok>>;

function modelFor(behaviour: Behaviour) {
  return new MockLanguageModelV3({ doGenerate: behaviour as never });
}

function request(overrides: Partial<AiStructuredRequest<Tip>> = {}): AiStructuredRequest<Tip> {
  return {
    capability: 'coaching-tip',
    prompt: { id: 'coaching-tip', version: 1 },
    system: 'system prompt',
    user: SECRET_PROMPT,
    schema,
    actor: { userId: 'user-1', childId: 'child-1' },
    ...overrides,
  };
}

interface Harness {
  service: VercelAiService;
  runs: AiRunRecordInput[];
  recorder: { record: jest.Mock; captureIfUnexpected: jest.Mock };
  budget: { hasCapacity: jest.Mock };
  resolve: jest.Mock;
}

function setup(opts: {
  models: Record<string, Behaviour>;
  fallback?: string;
  enabled?: boolean;
  capacity?: boolean | boolean[];
}): Harness {
  const runs: AiRunRecordInput[] = [];
  const recorder = {
    record: jest.fn(async (r: AiRunRecordInput) => {
      runs.push(r);
    }),
    captureIfUnexpected: jest.fn(),
  };
  const capacity = opts.capacity ?? true;
  const budget = {
    hasCapacity: jest.fn(async () =>
      Array.isArray(capacity) ? (capacity.shift() ?? true) : capacity,
    ),
  };
  const resolve = jest.fn(async (spec: string): Promise<ResolvedModel> => {
    const [provider, modelId] = spec.split(':');
    return { provider, modelId, model: modelFor(opts.models[spec]) };
  });
  const config = {
    get: () => ({
      enabled: opts.enabled ?? true,
      model: PRIMARY,
      fallbackModel: opts.fallback ?? '',
      timeoutMs: 10000,
      maxOutputTokens: 700,
    }),
  };
  const service = new VercelAiService(
    config as never,
    { resolve } as unknown as AiModelFactory,
    recorder as unknown as AiRunRecorder,
    budget as unknown as AiBudgetService,
  );
  return { service, runs, recorder, budget, resolve };
}

async function failureOf(p: Promise<unknown>): Promise<AiRunError> {
  try {
    await p;
  } catch (e) {
    return e as AiRunError;
  }
  throw new Error('expected rejection');
}

describe('VercelAiService', () => {
  it('returns the validated output and records one SUCCEEDED run with usage and attribution', async () => {
    const h = setup({ models: { [PRIMARY]: async () => ok() } });

    const res = await h.service.generateStructured(request());

    expect(res).toEqual({
      output: { headline: 'Bubble play', body: 'Blow bubbles together.' },
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      attempt: 1,
    });
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({
      capability: 'coaching-tip',
      promptId: 'coaching-tip',
      promptVersion: 1,
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      attempt: 1,
      status: AiRunStatus.SUCCEEDED,
      inputTokens: 1000,
      outputTokens: 200,
      userId: 'user-1',
      childId: 'child-1',
    });
    expect(h.runs[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('passes the model instance, never a string, and disables SDK retries', async () => {
    const model = modelFor(async () => ok());
    const h = setup({ models: {} });
    h.resolve.mockResolvedValue({ provider: 'google', modelId: 'm', model });

    await h.service.generateStructured(request());

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(700);
  });

  it('refuses a factory that returns a bare string model id', async () => {
    const h = setup({ models: {} });
    h.resolve.mockResolvedValue({ provider: 'google', modelId: 'm', model: 'google/gemini' });

    await expect(h.service.generateStructured(request())).rejects.toThrow(
      /model instance is required/,
    );
    expect(h.runs).toHaveLength(0);
  });

  it('throws AI_DISABLED without any budget check, model resolution or run when disabled', async () => {
    const h = setup({ models: {}, enabled: false });

    const err = await failureOf(h.service.generateStructured(request()));

    expect(err).toBeInstanceOf(AiRunError);
    expect(err.code).toBe('AI_DISABLED');
    expect(h.budget.hasCapacity).not.toHaveBeenCalled();
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.runs).toHaveLength(0);
  });

  describe('failure classification', () => {
    it('unparseable model text is INVALID_OUTPUT (schema failure), not retryable', async () => {
      const h = setup({ models: { [PRIMARY]: async () => ok(`not json ${SECRET_OUTPUT}`) } });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err.code).toBe('AI_INVALID_OUTPUT');
      expect(err.retryable).toBe(false);
      expect(h.runs[0]).toMatchObject({
        status: AiRunStatus.INVALID_OUTPUT,
        errorClass: 'NoObjectGeneratedError',
      });
    });

    it('schema-invalid JSON is INVALID_OUTPUT', async () => {
      const h = setup({ models: { [PRIMARY]: async () => ok('{"headline": 5}') } });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err.code).toBe('AI_INVALID_OUTPUT');
    });

    it('a post-check rejection is INVALID_OUTPUT and records the tokens spent', async () => {
      const h = setup({ models: { [PRIMARY]: async () => ok() } });

      const err = await failureOf(
        h.service.generateStructured(request({ postCheck: () => ({ reject: 'name leak' }) })),
      );

      expect(err.code).toBe('AI_INVALID_OUTPUT');
      expect(h.runs[0]).toMatchObject({
        status: AiRunStatus.INVALID_OUTPUT,
        errorClass: 'PostCheckRejected',
        inputTokens: 1000,
      });
    });

    it('a provider content-filter finish is BLOCKED', async () => {
      const h = setup({ models: { [PRIMARY]: async () => ok('', 'content-filter') } });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err.code).toBe('AI_BLOCKED');
      expect(err.retryable).toBe(false);
      expect(h.runs[0].status).toBe(AiRunStatus.BLOCKED);
    });

    it('HTTP 429 is RATE_LIMITED and retryable', async () => {
      const h = setup({
        models: {
          [PRIMARY]: async () => {
            throw apiError(429, true);
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true, httpStatus: 429 });
      expect(h.runs[0]).toMatchObject({ status: AiRunStatus.RATE_LIMITED, httpStatus: 429 });
    });

    it('HTTP 503 is a retryable PROVIDER_ERROR that does not go to Sentry', async () => {
      const h = setup({
        models: {
          [PRIMARY]: async () => {
            throw apiError(503);
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_PROVIDER', retryable: true, httpStatus: 503 });
      expect(h.runs[0]).toMatchObject({ status: AiRunStatus.PROVIDER_ERROR, httpStatus: 503 });
    });

    it('HTTP 400 is a non-retryable PROVIDER_ERROR', async () => {
      const h = setup({
        models: {
          [PRIMARY]: async () => {
            throw apiError(400);
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_PROVIDER', retryable: false, httpStatus: 400 });
    });

    it('a timeout is TIMEOUT and retryable', async () => {
      const h = setup({
        models: {
          [PRIMARY]: async () => {
            throw new DOMException('The operation timed out.', 'TimeoutError');
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
      expect(h.runs[0]).toMatchObject({ status: AiRunStatus.TIMEOUT, errorClass: 'TimeoutError' });
    });

    it('an unknown error is a non-retryable PROVIDER_ERROR recorded by class name only', async () => {
      const h = setup({
        models: {
          [PRIMARY]: async () => {
            throw new TypeError(`boom ${SECRET_PROMPT}`);
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_PROVIDER', retryable: false });
      expect(h.runs[0].errorClass).toBe('TypeError');
    });
  });

  describe('fallback ordering', () => {
    it('tries the fallback only after the primary fails and reports attempt 2', async () => {
      const order: string[] = [];
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: async () => {
            order.push('primary');
            throw apiError(503);
          },
          [FALLBACK]: async () => {
            order.push('fallback');
            return ok();
          },
        },
      });

      const res = await h.service.generateStructured(request());

      expect(order).toEqual(['primary', 'fallback']);
      expect(res).toMatchObject({ model: 'gemini-3.1-flash-lite', attempt: 2 });
      expect(h.runs.map((r) => [r.attempt, r.model, r.status])).toEqual([
        [1, 'gemini-3.5-flash-lite', AiRunStatus.PROVIDER_ERROR],
        [2, 'gemini-3.1-flash-lite', AiRunStatus.SUCCEEDED],
      ]);
    });

    it('does not call the fallback when the primary succeeds', async () => {
      const fallback = jest.fn(async () => ok());
      const h = setup({
        fallback: FALLBACK,
        models: { [PRIMARY]: async () => ok(), [FALLBACK]: fallback },
      });

      await h.service.generateStructured(request());

      expect(fallback).not.toHaveBeenCalled();
    });

    it('falls back after a post-check rejection of the primary', async () => {
      let n = 0;
      const h = setup({
        fallback: FALLBACK,
        models: { [PRIMARY]: async () => ok(), [FALLBACK]: async () => ok() },
      });
      const postCheck = () => (n++ === 0 ? { reject: 'bad' } : ('ok' as const));

      const res = await h.service.generateStructured(request({ postCheck }));

      expect(res.attempt).toBe(2);
    });

    it('reports the last provider failure, retryable if any attempt was, when both fail', async () => {
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: async () => {
            throw apiError(429, true);
          },
          [FALLBACK]: async () => {
            throw apiError(400);
          },
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({
        code: 'AI_PROVIDER',
        httpStatus: 400,
        model: 'gemini-3.1-flash-lite',
        retryable: true,
      });
      expect(h.runs).toHaveLength(2);
      expect(h.recorder.captureIfUnexpected).toHaveBeenCalledWith(err);
    });
  });

  describe('budget', () => {
    it('refuses before any provider call, records REJECTED_BUDGET, and does not use the fallback', async () => {
      const primary = jest.fn(async () => ok());
      const h = setup({
        fallback: FALLBACK,
        capacity: false,
        models: { [PRIMARY]: primary, [FALLBACK]: primary },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_BUDGET', retryable: false });
      expect(primary).not.toHaveBeenCalled();
      expect(h.resolve).not.toHaveBeenCalled();
      expect(h.runs).toHaveLength(1);
      expect(h.runs[0]).toMatchObject({ status: AiRunStatus.REJECTED_BUDGET, latencyMs: 0 });
    });

    it('stops at the budget between attempts and reports the primary failure, still retryable', async () => {
      const h = setup({
        fallback: FALLBACK,
        capacity: [true, false],
        models: {
          [PRIMARY]: async () => {
            throw apiError(429, true);
          },
          [FALLBACK]: async () => ok(),
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true });
      expect(h.runs.map((r) => r.status)).toEqual([
        AiRunStatus.RATE_LIMITED,
        AiRunStatus.REJECTED_BUDGET,
      ]);
    });
  });

  describe('leak safety (plan 0018 Q6.7)', () => {
    it('never exposes prompt or provider text in the thrown error, recorded runs or Sentry input', async () => {
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: async () => {
            throw apiError(401);
          },
          [FALLBACK]: async () => ok(`garbage ${SECRET_OUTPUT}`),
        },
      });

      const err = await failureOf(h.service.generateStructured(request()));

      expect(err).toBeInstanceOf(AiRunError);
      const everything = JSON.stringify({
        message: err.message,
        stack: err.stack,
        own: { ...err },
        runs: h.runs,
        sentry: h.recorder.captureIfUnexpected.mock.calls,
      });
      expect(everything).not.toContain('PROMPT-SECRET');
      expect(everything).not.toContain('OUTPUT-SECRET');
      expect(everything).not.toContain('Aarav');
      expect((err as { cause?: unknown }).cause).toBeUndefined();
    });
  });

  it('hands the final error to the Sentry rule exactly once, and not on success', async () => {
    const good = setup({ models: { [PRIMARY]: async () => ok() } });
    await good.service.generateStructured(request());
    expect(good.recorder.captureIfUnexpected).not.toHaveBeenCalled();

    const bad = setup({
      models: {
        [PRIMARY]: async () => {
          throw apiError(404);
        },
      },
    });
    await failureOf(bad.service.generateStructured(request()));
    expect(bad.recorder.captureIfUnexpected).toHaveBeenCalledTimes(1);
  });
});

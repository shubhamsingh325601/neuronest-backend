import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { AiRunStatus } from '@prisma/client';
import type { AiBudgetService } from './ai-budget.service';
import type { AiModelFactory, ResolvedModel } from './ai-model.factory';
import type { AiRunRecordInput, AiRunRecorder } from './ai-run.recorder';
import { AiRunError, type AiChatEvent, type AiChatRequest, type AiChatRun } from './ai.service';
import { VercelAiService } from './vercel-ai.service';

const PRIMARY = 'google:gemini-3.5-flash-lite';
const FALLBACK = 'google:gemini-3.1-flash-lite';
const SECRET_PROMPT = 'PROMPT-SECRET-7f3a child Aarav lives at 12 Lake Road';
const SECRET_OUTPUT = 'OUTPUT-SECRET-91bc';

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
};

type Part = Record<string, unknown>;
const textStart: Part = { type: 'text-start', id: 't' };
const delta = (text: string): Part => ({ type: 'text-delta', id: 't', delta: text });
const textEnd: Part = { type: 'text-end', id: 't' };
const finish = (unified: string = 'stop'): Part => ({
  type: 'finish',
  finishReason: { unified, raw: unified },
  usage,
});

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `leaky provider message containing ${SECRET_PROMPT}`,
    url: 'https://example.invalid/v1',
    requestBodyValues: { prompt: SECRET_PROMPT },
    statusCode,
    responseBody: SECRET_OUTPUT,
    isRetryable: statusCode >= 500,
  });
}

/** What the mock provider does: send these parts, then end, fail the connection, or stay silent. */
interface Script {
  parts: Part[];
  /** After the parts: close normally (default), error the connection, or send nothing more. */
  then?: 'close' | { fail: Error } | 'silent';
}

/** The options the SDK passed to the mock provider, per call, in order. */
const calls: { maxOutputTokens?: number; providerOptions?: unknown }[] = [];

function modelFor(script: Script) {
  return new MockLanguageModelV3({
    doStream: async (options: {
      abortSignal?: AbortSignal;
      maxOutputTokens?: number;
      providerOptions?: unknown;
    }) => {
      calls.push({
        maxOutputTokens: options.maxOutputTokens,
        providerOptions: options.providerOptions,
      });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of script.parts) controller.enqueue(part);
            const then = script.then ?? 'close';
            if (then === 'close') controller.close();
            // Later, so the reader has taken the parts first (erroring at once would discard them).
            else if (then !== 'silent') setTimeout(() => controller.error(then.fail), 20);
            else {
              options.abortSignal?.addEventListener('abort', () => {
                try {
                  controller.error(new DOMException('aborted', 'AbortError'));
                } catch {
                  /* already closed */
                }
              });
            }
          },
        }),
      };
    },
  } as never);
}

function setup(opts: {
  models: Record<string, Script>;
  fallback?: string;
  enabled?: boolean;
  capacity?: boolean | boolean[];
  chunkTimeoutMs?: number;
  firstTokenTimeoutMs?: number;
}) {
  calls.length = 0;
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
    get: (key: string) =>
      key === 'aiChat'
        ? {
            maxOutputTokens: 400,
            totalTimeoutMs: 60000,
            firstTokenTimeoutMs: opts.firstTokenTimeoutMs ?? 20000,
            thinkingLevel: '',
          }
        : {
            enabled: opts.enabled ?? true,
            model: PRIMARY,
            fallbackModel: opts.fallback ?? '',
            timeoutMs: opts.chunkTimeoutMs ?? 10000,
            maxOutputTokens: 700,
          },
  };
  const service = new VercelAiService(
    config as never,
    { resolve } as unknown as AiModelFactory,
    recorder as unknown as AiRunRecorder,
    budget as unknown as AiBudgetService,
  );
  return { service, runs, recorder, resolve };
}

function request(signal: AbortSignal = new AbortController().signal): AiChatRequest {
  return {
    capability: 'chat-reply',
    prompt: { id: 'chat-reply', version: 1 },
    system: 'system prompt',
    messages: [{ role: 'user', content: SECRET_PROMPT }],
    actor: { userId: 'user-1', childId: 'child-1' },
    signal,
  };
}

async function read(run: AiChatRun, until?: (e: AiChatEvent) => boolean): Promise<AiChatEvent[]> {
  const events: AiChatEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
    if (until?.(event)) break;
  }
  return events;
}

async function failureOf(p: Promise<unknown>): Promise<AiRunError> {
  try {
    await p;
  } catch (e) {
    return e as AiRunError;
  }
  throw new Error('expected rejection');
}

describe('VercelAiService.streamChat', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('streams the text without the empty delta, ends with the finish reason and records on finish', async () => {
    const h = setup({
      models: {
        [PRIMARY]: {
          parts: [textStart, delta('Hello '), delta(''), delta('there.'), textEnd, finish()],
        },
      },
    });
    const run = h.service.streamChat(request());

    const events = await read(run);

    expect(events).toEqual([
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'there.' },
      { type: 'end', finishReason: 'stop' },
    ]);
    expect(h.runs).toHaveLength(0); // nothing is recorded until the caller gives its verdict
    await run.finish('COMPLETE');
    expect(h.runs).toEqual([
      expect.objectContaining({
        capability: 'chat-reply',
        promptId: 'chat-reply',
        promptVersion: 1,
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        attempt: 1,
        status: AiRunStatus.SUCCEEDED,
        inputTokens: 120,
        outputTokens: 30,
        userId: 'user-1',
        childId: 'child-1',
      }),
    ]);
    await run.finish('COMPLETE');
    expect(h.runs).toHaveLength(1);
  });

  it('reports a reply cut at the token limit as finishReason length', async () => {
    const h = setup({
      models: { [PRIMARY]: { parts: [textStart, delta('Cut'), textEnd, finish('length')] } },
    });

    const events = await read(h.service.streamChat(request()));

    expect(events[events.length - 1]).toEqual({ type: 'end', finishReason: 'length' });
  });

  it("records the caller's verdict: a reply it blocked mid-stream has no token counts", async () => {
    const h = setup({
      models: { [PRIMARY]: { parts: [textStart, delta('First. ')], then: 'silent' } },
    });
    const run = h.service.streamChat(request());

    await read(run, (e) => e.type === 'delta'); // stops reading after the first delta
    await run.finish('BLOCKED');

    expect(h.runs).toEqual([expect.objectContaining({ status: AiRunStatus.BLOCKED, attempt: 1 })]);
    expect(h.runs[0].inputTokens).toBeUndefined();
    expect(h.runs[0].outputTokens).toBeUndefined();
  });

  it('records an unusable reply as INVALID_OUTPUT with the tokens the provider reported', async () => {
    const h = setup({
      models: { [PRIMARY]: { parts: [textStart, delta('  '), textEnd, finish()] } },
    });
    const run = h.service.streamChat(request());

    await read(run);
    await run.finish('INVALID_OUTPUT');

    expect(h.runs[0]).toMatchObject({ status: AiRunStatus.INVALID_OUTPUT, outputTokens: 30 });
  });

  describe('thinking limit', () => {
    it('asks Gemini 3.5 for minimal thinking and adds room for it to the output limit', async () => {
      const h = setup({
        models: { [PRIMARY]: { parts: [textStart, delta('Hi.'), textEnd, finish()] } },
      });

      await read(h.service.streamChat(request()));

      expect(calls).toEqual([
        {
          maxOutputTokens: 528,
          providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
        },
      ]);
    });
  });

  describe('failures', () => {
    it('a reply that hit the length limit before any text (thinking) is a failed attempt, tokens kept', async () => {
      const h = setup({ models: { [PRIMARY]: { parts: [textStart, textEnd, finish('length')] } } });

      const err = await failureOf(read(h.service.streamChat(request())));

      expect(err).toMatchObject({ code: 'AI_INVALID_OUTPUT', errorClass: 'LengthWithoutText' });
      expect(h.runs[0]).toMatchObject({
        status: AiRunStatus.INVALID_OUTPUT,
        errorClass: 'LengthWithoutText',
        outputTokens: 30,
      });
    });

    it('tries the fallback model after a length-without-text attempt, recording both', async () => {
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: { parts: [textStart, textEnd, finish('length')] },
          [FALLBACK]: { parts: [textStart, delta('Hello.'), textEnd, finish()] },
        },
      });
      const run = h.service.streamChat(request());

      const events = await read(run);
      await run.finish('COMPLETE');

      expect(events[0]).toEqual({ type: 'delta', text: 'Hello.' });
      expect(h.runs.map((r) => [r.attempt, r.status])).toEqual([
        [1, AiRunStatus.INVALID_OUTPUT],
        [2, AiRunStatus.SUCCEEDED],
      ]);
      expect(h.runs[0].outputTokens).toBe(30);
    });

    it('a provider that takes the request but sends nothing is cut at the first-token timeout', async () => {
      const h = setup({
        firstTokenTimeoutMs: 60,
        models: { [PRIMARY]: { parts: [], then: 'silent' } },
      });
      const started = Date.now();

      const err = await failureOf(read(h.service.streamChat(request())));

      expect(err).toMatchObject({ code: 'AI_TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(h.runs[0]).toMatchObject({ status: AiRunStatus.TIMEOUT });
    });

    it('tries the fallback model when the first model never produces a first token', async () => {
      const h = setup({
        firstTokenTimeoutMs: 60,
        fallback: FALLBACK,
        models: {
          [PRIMARY]: { parts: [], then: 'silent' },
          [FALLBACK]: { parts: [textStart, delta('Quick.'), textEnd, finish()] },
        },
      });
      const run = h.service.streamChat(request());

      const events = await read(run);
      await run.finish('COMPLETE');

      expect(events[0]).toEqual({ type: 'delta', text: 'Quick.' });
      expect(h.runs.map((r) => [r.attempt, r.status])).toEqual([
        [1, AiRunStatus.TIMEOUT],
        [2, AiRunStatus.SUCCEEDED],
      ]);
    });

    it('an error before the first text is thrown, recorded once, and never logged by the SDK', async () => {
      const h = setup({
        models: { [PRIMARY]: { parts: [{ type: 'error', error: apiError(503) }] } },
      });
      const run = h.service.streamChat(request());

      const err = await failureOf(read(run));

      expect(err).toBeInstanceOf(AiRunError);
      expect(err).toMatchObject({ code: 'AI_PROVIDER', httpStatus: 503, retryable: true });
      expect(h.runs).toEqual([
        expect.objectContaining({
          status: AiRunStatus.PROVIDER_ERROR,
          errorClass: 'APICallError',
          httpStatus: 503,
        }),
      ]);
      expect(h.runs[0].inputTokens).toBeUndefined();
      await run.finish('COMPLETE'); // already recorded: a no-op
      expect(h.runs).toHaveLength(1);
      expect(consoleError).not.toHaveBeenCalled();
      expect(JSON.stringify([err.message, err.errorClass, h.runs])).not.toMatch(
        /PROMPT-SECRET|OUTPUT-SECRET|Aarav/,
      );
      expect(h.recorder.captureIfUnexpected).toHaveBeenCalledTimes(1);
    });

    it('tries the fallback model when nothing has been sent yet', async () => {
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: { parts: [{ type: 'error', error: apiError(429) }] },
          [FALLBACK]: { parts: [textStart, delta('From fallback.'), textEnd, finish()] },
        },
      });
      const run = h.service.streamChat(request());

      const events = await read(run);
      await run.finish('COMPLETE');

      expect(events[0]).toEqual({ type: 'delta', text: 'From fallback.' });
      expect(h.runs.map((r) => [r.attempt, r.model, r.status])).toEqual([
        [1, 'gemini-3.5-flash-lite', AiRunStatus.RATE_LIMITED],
        [2, 'gemini-3.1-flash-lite', AiRunStatus.SUCCEEDED],
      ]);
    });

    it('does not try the fallback once text has been sent: the failure surfaces', async () => {
      const h = setup({
        fallback: FALLBACK,
        models: {
          [PRIMARY]: {
            parts: [textStart, delta('Begun. ')],
            then: { fail: new Error(`connection reset ${SECRET_PROMPT}`) },
          },
          [FALLBACK]: { parts: [textStart, delta('Never used.'), textEnd, finish()] },
        },
      });
      const run = h.service.streamChat(request());
      const seen: AiChatEvent[] = [];

      const err = await failureOf(
        (async () => {
          for await (const event of run.events) seen.push(event);
        })(),
      );

      expect(seen).toEqual([{ type: 'delta', text: 'Begun. ' }]);
      expect(err).toMatchObject({ code: 'AI_PROVIDER' });
      expect(h.runs).toHaveLength(1);
      expect(h.runs[0]).toMatchObject({ attempt: 1, status: AiRunStatus.PROVIDER_ERROR });
      expect(JSON.stringify([err.message, h.runs])).not.toContain('PROMPT-SECRET');
    });

    it('a provider that ends with an error finish reason is a PROVIDER_ERROR, not a complete reply', async () => {
      const h = setup({
        models: { [PRIMARY]: { parts: [textStart, delta('Half'), textEnd, finish('other')] } },
      });
      const run = h.service.streamChat(request());

      const err = await failureOf(read(run));

      expect(err).toMatchObject({ code: 'AI_PROVIDER', errorClass: 'UnexpectedFinish' });
      expect(h.runs[0]).toMatchObject({
        status: AiRunStatus.PROVIDER_ERROR,
        errorClass: 'UnexpectedFinish',
      });
    });

    it('a provider content filter is BLOCKED', async () => {
      const h = setup({
        models: { [PRIMARY]: { parts: [textStart, textEnd, finish('content-filter')] } },
      });

      const err = await failureOf(read(h.service.streamChat(request())));

      expect(err).toMatchObject({ code: 'AI_BLOCKED' });
      expect(h.runs[0].status).toBe(AiRunStatus.BLOCKED);
    });

    it('a silent provider is cut by the stall timeout and recorded as TIMEOUT', async () => {
      const h = setup({
        chunkTimeoutMs: 60,
        models: { [PRIMARY]: { parts: [textStart, delta('Slow. ')], then: 'silent' } },
      });
      const run = h.service.streamChat(request());

      const err = await failureOf(read(run));

      expect(err).toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
      expect(h.runs).toEqual([expect.objectContaining({ status: AiRunStatus.TIMEOUT })]);
    });

    it('is refused without a provider call when AI is off or the budget is spent', async () => {
      const off = setup({ enabled: false, models: {} });
      expect(await failureOf(read(off.service.streamChat(request())))).toMatchObject({
        code: 'AI_DISABLED',
      });
      expect(off.runs).toHaveLength(0);
      expect(off.resolve).not.toHaveBeenCalled();

      const spent = setup({ capacity: false, models: {} });
      const run = spent.service.streamChat(request());
      expect(await failureOf(read(run))).toMatchObject({ code: 'AI_BUDGET' });
      expect(spent.runs).toEqual([
        expect.objectContaining({ status: AiRunStatus.REJECTED_BUDGET, latencyMs: 0 }),
      ]);
      expect(spent.resolve).not.toHaveBeenCalled();
    });
  });

  describe('client leaves', () => {
    it('ends quietly, records CLIENT_ABORTED with null tokens, and stops the provider', async () => {
      const h = setup({
        models: { [PRIMARY]: { parts: [textStart, delta('Going. ')], then: 'silent' } },
      });
      const controller = new AbortController();
      const run = h.service.streamChat(request(controller.signal));
      const seen: AiChatEvent[] = [];

      for await (const event of run.events) {
        seen.push(event);
        controller.abort(); // the client disconnects after the first text
      }

      expect(seen).toEqual([{ type: 'delta', text: 'Going. ' }]);
      expect(h.runs).toEqual([
        expect.objectContaining({ status: AiRunStatus.CLIENT_ABORTED, attempt: 1 }),
      ]);
      expect(h.runs[0].inputTokens).toBeUndefined();
      expect(h.runs[0].outputTokens).toBeUndefined();
      await run.finish('COMPLETE');
      expect(h.runs).toHaveLength(1);
    });

    it('makes no provider call when the client is already gone', async () => {
      const h = setup({ models: { [PRIMARY]: { parts: [] } } });
      const controller = new AbortController();
      controller.abort();

      const events = await read(h.service.streamChat(request(controller.signal)));

      expect(events).toEqual([]);
      expect(h.resolve).not.toHaveBeenCalled();
      expect(h.runs).toHaveLength(0);
    });
  });
});

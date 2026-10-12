import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, Output, streamText } from 'ai';
import { AiRunStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { AiBudgetService } from './ai-budget.service';
import { AiModelFactory, parseModelSpec } from './ai-model.factory';
import { AiRunRecorder, type AiRunRecordInput } from './ai-run.recorder';
import {
  AiRunError,
  AiService,
  type AiChatEvent,
  type AiChatOutcome,
  type AiChatRequest,
  type AiChatRun,
  type AiStructuredRequest,
  type AiStructuredResult,
} from './ai.service';
import {
  classifyFailure,
  STATUS_TO_CODE,
  type ClassifiedFailure,
} from './vercel-error.classifier';

type AiConfig = AppConfig['ai'];

/** What a streamed chat run needs to be recorded once, whichever way it ends. */
interface ChatRunState {
  recorded: boolean;
  /** The attempt that is (or was last) reading from the provider. */
  current?: {
    base: Omit<AiRunRecordInput, 'status' | 'latencyMs'>;
    started: number;
    controller: AbortController;
    /** Only known once the provider finished; an aborted stream has no usage (plan 0019 section 14). */
    usage?: { inputTokens?: number; outputTokens?: number };
  };
}

const OUTCOME_STATUS: Record<AiChatOutcome, AiRunStatus> = {
  COMPLETE: AiRunStatus.SUCCEEDED,
  BLOCKED: AiRunStatus.BLOCKED,
  INVALID_OUTPUT: AiRunStatus.INVALID_OUTPUT,
};

type Attempt<T> = { ok: true; result: AiStructuredResult<T> } | { ok: false; error: AiRunError };

/**
 * The only service that talks to the Vercel AI SDK (plan 0018 Q2). One non-streaming,
 * tool-free `generateText` call per attempt, with the SDK's own retries off: our attempt list
 * `[AI_MODEL, AI_FALLBACK_MODEL?]` is the retry policy, and every attempt is a counted, recorded
 * provider request. Every failure leaves as an {@link AiRunError}; SDK errors, prompts and model
 * text never escape this file.
 */
@Injectable()
export class VercelAiService extends AiService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly models: AiModelFactory,
    private readonly recorder: AiRunRecorder,
    private readonly budget: AiBudgetService,
  ) {
    super();
  }

  async generateStructured<T>(req: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    const cfg = this.config.get('ai', { infer: true });
    if (!cfg.enabled) throw new AiRunError('AI_DISABLED');

    const specs = cfg.fallbackModel ? [cfg.model, cfg.fallbackModel] : [cfg.model];
    const failures: AiRunError[] = [];

    for (let i = 0; i < specs.length; i++) {
      const attempt = await this.runAttempt(req, cfg, specs[i], i + 1);
      if (attempt.ok) return attempt.result;
      failures.push(attempt.error);
      // The budget is project-wide: once it is spent no further attempt could be made either.
      if (attempt.error.code === 'AI_BUDGET') break;
    }

    // Report the most informative failure: the last real provider outcome, else the budget refusal.
    const last = [...failures].reverse().find((f) => f.code !== 'AI_BUDGET') ?? failures[0];
    const final = new AiRunError(last.code, {
      retryable: failures.some((f) => f.retryable),
      provider: last.provider,
      model: last.model,
      httpStatus: last.httpStatus,
      errorClass: last.errorClass,
    });
    this.recorder.captureIfUnexpected(final);
    throw final;
  }

  private async runAttempt<T>(
    req: AiStructuredRequest<T>,
    cfg: AiConfig,
    spec: string,
    attempt: number,
  ): Promise<Attempt<T>> {
    const { provider, modelId } = parseModelSpec(spec);
    const base = {
      capability: req.capability,
      promptId: req.prompt.id,
      promptVersion: req.prompt.version,
      provider,
      model: modelId,
      attempt,
      userId: req.actor.userId,
      childId: req.actor.childId,
    };

    if (!(await this.budget.hasCapacity())) {
      await this.recorder.record({ ...base, status: AiRunStatus.REJECTED_BUDGET, latencyMs: 0 });
      return { ok: false, error: new AiRunError('AI_BUDGET', { provider, model: modelId }) };
    }

    const resolved = await this.models.resolve(spec);
    // A bare string id would silently route through the Vercel AI Gateway (plan 0018 Q2.3).
    if (typeof resolved.model === 'string') {
      throw new Error('AiModelFactory returned a bare model id; a model instance is required');
    }

    const started = Date.now();
    try {
      const result = await generateText({
        model: resolved.model,
        system: req.system,
        prompt: req.user,
        output: Output.object({ schema: req.schema }),
        maxRetries: 0,
        timeout: cfg.timeoutMs,
        maxOutputTokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
      });
      const latencyMs = Date.now() - started;
      const usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        warnings: result.warnings?.length ?? 0,
      };

      if (result.finishReason === 'content-filter') {
        await this.recorder.record({ ...base, ...usage, latencyMs, status: AiRunStatus.BLOCKED });
        return { ok: false, error: new AiRunError('AI_BLOCKED', { provider, model: modelId }) };
      }

      const output = result.output as T;
      const verdict = req.postCheck?.(output) ?? 'ok';
      if (verdict !== 'ok') {
        await this.recorder.record({
          ...base,
          ...usage,
          latencyMs,
          status: AiRunStatus.INVALID_OUTPUT,
          errorClass: 'PostCheckRejected',
        });
        return {
          ok: false,
          error: new AiRunError('AI_INVALID_OUTPUT', {
            provider,
            model: modelId,
            errorClass: 'PostCheckRejected',
          }),
        };
      }

      await this.recorder.record({ ...base, ...usage, latencyMs, status: AiRunStatus.SUCCEEDED });
      return { ok: true, result: { output, provider, model: modelId, attempt } };
    } catch (err) {
      const failure = classifyFailure(err);
      await this.recorder.record({
        ...base,
        status: failure.status,
        errorClass: failure.errorClass,
        httpStatus: failure.httpStatus,
        inputTokens: failure.inputTokens,
        outputTokens: failure.outputTokens,
        latencyMs: Date.now() - started,
      });
      return {
        ok: false,
        error: new AiRunError(STATUS_TO_CODE[failure.status as keyof typeof STATUS_TO_CODE], {
          retryable: failure.retryable,
          provider,
          model: modelId,
          httpStatus: failure.httpStatus,
          errorClass: failure.errorClass,
        }),
      };
    }
  }

  /**
   * One streamed, tool-free reply (plan 0019 section 6.5). The same attempt list as
   * `generateStructured`, but the fallback model is only tried while nothing has been sent yet. Every
   * failure leaves as an {@link AiRunError}; the SDK's own error handling is replaced by `onError`,
   * because its default logs the error object, which carries the prompt.
   */
  streamChat(req: AiChatRequest): AiChatRun {
    const state: ChatRunState = { recorded: false };
    return {
      events: this.chatEvents(req, state),
      finish: (outcome) => this.finishChat(state, outcome),
    };
  }

  private async *chatEvents(req: AiChatRequest, state: ChatRunState): AsyncGenerator<AiChatEvent> {
    const cfg = this.config.get('ai', { infer: true });
    const chat = this.config.get('aiChat', { infer: true });
    if (!cfg.enabled) throw new AiRunError('AI_DISABLED');

    const specs = cfg.fallbackModel ? [cfg.model, cfg.fallbackModel] : [cfg.model];
    const failures: AiRunError[] = [];

    for (let i = 0; i < specs.length; i++) {
      if (req.signal.aborted) return;
      const { provider, modelId } = parseModelSpec(specs[i]);
      const base = {
        capability: req.capability,
        promptId: req.prompt.id,
        promptVersion: req.prompt.version,
        provider,
        model: modelId,
        attempt: i + 1,
        userId: req.actor.userId,
        childId: req.actor.childId,
      };

      if (!(await this.budget.hasCapacity())) {
        await this.recorder.record({ ...base, status: AiRunStatus.REJECTED_BUDGET, latencyMs: 0 });
        failures.push(new AiRunError('AI_BUDGET', { provider, model: modelId }));
        break;
      }

      const resolved = await this.models.resolve(specs[i]);
      // A bare string id would silently route through the Vercel AI Gateway (plan 0018 Q2.3).
      if (typeof resolved.model === 'string') {
        throw new Error('AiModelFactory returned a bare model id; a model instance is required');
      }

      const controller = new AbortController();
      const onClientLeft = () => controller.abort();
      req.signal.addEventListener('abort', onClientLeft, { once: true });
      const current: NonNullable<ChatRunState['current']> = {
        base,
        started: Date.now(),
        controller,
      };
      state.current = current;

      let sent = false;
      let reported: ClassifiedFailure | undefined;
      let failure: ClassifiedFailure | undefined;
      let finishReason: string | undefined;
      let aborted = false;
      try {
        const result = streamText({
          model: resolved.model,
          system: req.system,
          messages: req.messages,
          maxRetries: 0,
          abortSignal: controller.signal,
          timeout: { chunkMs: cfg.timeoutMs, totalMs: chat.totalTimeoutMs },
          maxOutputTokens: req.maxOutputTokens ?? chat.maxOutputTokens,
          // Never the SDK default (it logs the error object, which holds the prompt): class and status only.
          onError: ({ error }) => {
            reported = classifyFailure(error);
          },
        });
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            if (part.text.length === 0) continue;
            sent = true;
            yield { type: 'delta', text: part.text };
          } else if (part.type === 'error') {
            failure = reported ?? classifyFailure(part.error);
            break;
          } else if (part.type === 'abort') {
            aborted = true;
            break;
          } else if (part.type === 'finish') {
            finishReason = part.finishReason;
            current.usage = {
              inputTokens: part.totalUsage.inputTokens,
              outputTokens: part.totalUsage.outputTokens,
            };
          }
        }
      } catch (err) {
        // The loop itself throws on a connection reset mid-stream.
        failure = classifyFailure(err);
      } finally {
        req.signal.removeEventListener('abort', onClientLeft);
      }

      if (req.signal.aborted) {
        await this.recordChat(state, AiRunStatus.CLIENT_ABORTED);
        return;
      }
      if (aborted) failure = classifyFailure({ name: 'TimeoutError' });
      if (!failure && finishReason !== 'stop' && finishReason !== 'length') {
        failure =
          finishReason === 'content-filter'
            ? {
                status: AiRunStatus.BLOCKED,
                code: 'AI_BLOCKED',
                retryable: false,
                errorClass: 'ContentFilter',
              }
            : {
                status: AiRunStatus.PROVIDER_ERROR,
                code: 'AI_PROVIDER',
                retryable: false,
                errorClass: 'UnexpectedFinish',
              };
      }
      if (!failure) {
        yield { type: 'end', finishReason: finishReason as 'stop' | 'length' };
        return;
      }

      const error = new AiRunError(STATUS_TO_CODE[failure.status as keyof typeof STATUS_TO_CODE], {
        retryable: failure.retryable,
        provider,
        model: modelId,
        httpStatus: failure.httpStatus,
        errorClass: failure.errorClass,
      });
      failures.push(error);
      const last = i === specs.length - 1;
      if (sent || last) {
        await this.recordChat(state, failure.status, failure);
        this.recorder.captureIfUnexpected(error);
        throw error;
      }
      // Nothing was sent yet, so the next model can still answer. This attempt is a counted request.
      await this.recorder.record({
        ...base,
        status: failure.status,
        errorClass: failure.errorClass,
        httpStatus: failure.httpStatus,
        latencyMs: Date.now() - current.started,
      });
      state.current = undefined;
    }

    // Only the budget refusal ends the loop without a provider outcome: report the last real one, else the refusal.
    const final = [...failures].reverse().find((f) => f.code !== 'AI_BUDGET') ?? failures[0];
    state.recorded = true;
    this.recorder.captureIfUnexpected(final);
    throw final;
  }

  private async finishChat(state: ChatRunState, outcome: AiChatOutcome): Promise<void> {
    const { current } = state;
    if (!current || state.recorded) return;
    // A stream the caller stopped reading is still open at the provider.
    current.controller.abort();
    await this.recordChat(state, OUTCOME_STATUS[outcome]);
  }

  /** Writes the run once. An aborted or unfinished stream has no usage, so its tokens stay null. */
  private async recordChat(
    state: ChatRunState,
    status: AiRunStatus,
    failure?: ClassifiedFailure,
  ): Promise<void> {
    const { current } = state;
    if (!current || state.recorded) return;
    state.recorded = true;
    await this.recorder.record({
      ...current.base,
      status,
      errorClass: failure?.errorClass,
      httpStatus: failure?.httpStatus,
      inputTokens: current.usage?.inputTokens,
      outputTokens: current.usage?.outputTokens,
      latencyMs: Date.now() - current.started,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, Output } from 'ai';
import { AiRunStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { AiBudgetService } from './ai-budget.service';
import { AiModelFactory, parseModelSpec } from './ai-model.factory';
import { AiRunRecorder } from './ai-run.recorder';
import {
  AiRunError,
  AiService,
  type AiStructuredRequest,
  type AiStructuredResult,
} from './ai.service';
import { classifyFailure, STATUS_TO_CODE } from './vercel-error.classifier';

type AiConfig = AppConfig['ai'];

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
}

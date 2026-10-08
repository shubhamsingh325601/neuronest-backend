import { Injectable, Logger } from '@nestjs/common';
import { AiRunStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '@common/prisma/prisma.service';
import { estimateCostMicroUsd } from './ai-pricing';
import type { AiRunError } from './ai.service';

/** Everything the recorder needs for one provider attempt. Metadata only - there is no field for text. */
export interface AiRunRecordInput {
  capability: string;
  promptId: string;
  promptVersion: number;
  provider: string;
  model: string;
  attempt: number;
  status: AiRunStatus;
  errorClass?: string;
  httpStatus?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  /** SDK warning count (not the warnings themselves). */
  warnings?: number;
  userId?: string;
  childId?: string;
}

/**
 * The whole shape written to the Pino log for an attempt (plan 0018 Q7.3). A typed whitelist of
 * ids, enums and numbers: nothing here can carry a prompt, an output, or an SDK error message.
 */
interface AiRunLog {
  capability: string;
  promptId: string;
  promptVersion: number;
  provider: string;
  model: string;
  attempt: number;
  status: AiRunStatus;
  errorClass: string | null;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  warnings: number;
}

/** Provider responses that signal our own bug or misconfiguration rather than operational noise. */
const SENTRY_HTTP_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Writes one `ai_runs` row and one structured log line per provider attempt, and applies the
 * Sentry policy (plan 0018 Q7.4). Recording never throws: losing a metadata row must not turn a
 * good generation into a failure, and a failed insert reports only the error class.
 */
@Injectable()
export class AiRunRecorder {
  private readonly logger = new Logger(AiRunRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AiRunRecordInput): Promise<void> {
    const line: AiRunLog = {
      capability: input.capability,
      promptId: input.promptId,
      promptVersion: input.promptVersion,
      provider: input.provider,
      model: input.model,
      attempt: input.attempt,
      status: input.status,
      errorClass: input.errorClass ?? null,
      httpStatus: input.httpStatus ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      latencyMs: input.latencyMs,
      warnings: input.warnings ?? 0,
    };
    if (input.status === AiRunStatus.SUCCEEDED) this.logger.log(line, 'ai run');
    else this.logger.warn(line, 'ai run');

    try {
      await this.prisma.aiRun.create({
        data: {
          capability: input.capability,
          promptId: input.promptId,
          promptVersion: input.promptVersion,
          provider: input.provider,
          model: input.model,
          attempt: input.attempt,
          status: input.status,
          errorClass: input.errorClass,
          httpStatus: input.httpStatus,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          latencyMs: input.latencyMs,
          costEstimateMicroUsd: estimateCostMicroUsd(
            input.provider,
            input.model,
            input.inputTokens,
            input.outputTokens,
          ),
          userId: input.userId,
          childId: input.childId,
        },
      });
    } catch (err) {
      this.logger.error(
        { errorClass: err instanceof Error ? err.name : 'UnknownError' },
        'ai run not recorded',
      );
    }
  }

  /**
   * Sentry only for failures that are not expected operational noise: provider 400/401/403/404
   * (bad key, wrong model id, our bug) and a request that ended with no valid output. Not 429, 5xx,
   * timeouts or budget rejections - the admin usage view covers those. Always our own AiRunError.
   */
  captureIfUnexpected(err: AiRunError): void {
    const unexpected =
      err.code === 'AI_INVALID_OUTPUT' ||
      (err.code === 'AI_PROVIDER' &&
        err.httpStatus !== undefined &&
        SENTRY_HTTP_STATUSES.has(err.httpStatus));
    if (!unexpected) return;
    Sentry.captureException(err, {
      tags: { aiCode: err.code, aiProvider: err.provider, aiModel: err.model },
      extra: { httpStatus: err.httpStatus, errorClass: err.errorClass },
    });
  }
}

import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiOutputStatus, Prisma, type AiOutput } from '@prisma/client';
import { AiRunError, AiService, type AiRunErrorCode } from '@common/ai/ai.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import type { ChildDto } from '@modules/children/shared/child.dto';
import { AiAccessService } from './ai-access.service';
import type { FailureReason } from './ai-coaching.constants';
import { CoachingContextBuilder, type BuiltCoachingContext } from './coaching-context.builder';
import { buildCoachingTipRequest, coachingTipPrompt } from './coaching-tip.request';

export interface PreparedGeneration {
  child: ChildDto;
  built: BuiltCoachingContext;
}

/**
 * - `READY`: validated tip stored.
 * - `FAILED`: gave up; the row is already `FAILED` (or restored to its previous `READY` tip).
 * - `RETRYABLE`: a transient provider failure; the row is untouched (still `PENDING`) and the
 *   caller decides between a queued retry and giving up via {@link CoachingTipGenerator.markFailed}.
 * - `SKIPPED`: the row was no longer `PENDING` (someone else finished it).
 */
export type GenerationOutcome =
  | { kind: 'READY' }
  | { kind: 'FAILED'; reason: FailureReason }
  | { kind: 'RETRYABLE'; reason: FailureReason; error: AiRunError }
  | { kind: 'SKIPPED' };

const REASON_BY_CODE: Record<AiRunErrorCode, FailureReason> = {
  AI_DISABLED: 'DISABLED',
  AI_BUDGET: 'CAPACITY',
  AI_BLOCKED: 'BLOCKED',
  AI_INVALID_OUTPUT: 'BLOCKED',
  AI_RATE_LIMITED: 'PROVIDER',
  AI_TIMEOUT: 'PROVIDER',
  AI_PROVIDER: 'PROVIDER',
};

/**
 * Runs one generation for a claimed (`PENDING`) `ai_outputs` row, as a given caller. Shared by
 * the request path and the background job so both apply identical authorization, context
 * minimisation, validation and persistence (plan 0018 Q9.4/Q9.5).
 */
@Injectable()
export class CoachingTipGenerator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: AiAccessService,
    private readonly builder: CoachingContextBuilder,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Re-authorises the caller for the child and builds the minimised context. Throws the same
   * `HttpException`s the parent's own screens would (`403`, `404 CHILD_NOT_FOUND`,
   * `404 PLAN_NOT_FOUND`, `503 AI_DISABLED`).
   */
  async prepare(
    childId: string,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<PreparedGeneration> {
    const child = await this.access.assertCanGenerate(childId, caller);
    return { child, built: await this.builder.build(child, caller, now) };
  }

  /** Maps an authorization/context failure from {@link prepare} to a stored reason. */
  static reasonForHttpError(err: HttpException): FailureReason {
    const body = err.getResponse();
    const code = typeof body === 'object' ? (body as { code?: string }).code : undefined;
    if (code === 'AI_DISABLED') return 'DISABLED';
    if (code === 'PLAN_NOT_FOUND') return 'NO_PLAN';
    return 'ACCESS';
  }

  async generate(
    output: Pick<AiOutput, 'id' | 'content'>,
    prepared: PreparedGeneration,
    caller: AuthenticatedUser,
  ): Promise<GenerationOutcome> {
    const prompt = coachingTipPrompt;
    const { child, built } = prepared;

    let result;
    try {
      result = await this.ai.generateStructured(
        buildCoachingTipRequest(
          built,
          { userId: caller.id, childId: child.id },
          this.config.get('ai', { infer: true }).maxOutputTokens,
        ),
      );
    } catch (err) {
      if (!(err instanceof AiRunError)) throw err;
      const reason = REASON_BY_CODE[err.code];
      if (err.retryable) return { kind: 'RETRYABLE', reason, error: err };
      await this.markFailed(output, reason);
      return { kind: 'FAILED', reason };
    }

    const updated = await this.prisma.aiOutput.updateMany({
      where: { id: output.id, status: AiOutputStatus.PENDING },
      data: {
        status: AiOutputStatus.READY,
        content: result.output as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputHash: built.inputHash(prompt.version),
        promptVersion: prompt.version,
        failureReason: null,
      },
    });
    return updated.count === 1 ? { kind: 'READY' } : { kind: 'SKIPPED' };
  }

  /**
   * Gives up on a `PENDING` row. If it already holds an earlier validated tip (a failed
   * regeneration), that tip is kept and shown again; otherwise the row becomes `FAILED`.
   */
  async markFailed(output: Pick<AiOutput, 'id' | 'content'>, reason: FailureReason): Promise<void> {
    await this.prisma.aiOutput.updateMany({
      where: { id: output.id, status: AiOutputStatus.PENDING },
      data: {
        status: output.content === null ? AiOutputStatus.FAILED : AiOutputStatus.READY,
        failureReason: reason,
      },
    });
  }
}

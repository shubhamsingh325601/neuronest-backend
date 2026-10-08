import {
  AiRunError,
  AiService,
  type AiStructuredRequest,
  type AiStructuredResult,
} from '@common/ai/ai.service';

export interface FakeAiCall {
  capability: string;
  promptId: string;
  promptVersion: number;
  system: string;
  user: string;
  actor: { userId: string; childId?: string };
}

type Scripted = { output: unknown } | { error: AiRunError };

/**
 * In-memory AiService for e2e tests (same role as FakeEmailService). Scripted responses are
 * consumed in order; like the real service it validates the output against the request schema
 * and runs `postCheck`, so a test cannot pass by scripting something the pipeline would reject.
 * It never makes a network call and writes no `ai_runs` rows.
 */
export class FakeAiService extends AiService {
  readonly calls: FakeAiCall[] = [];
  private readonly queue: Scripted[] = [];

  /** Returned for every call once the queue is empty. Unset = an empty queue throws. */
  defaultOutput: unknown;

  willReturn(output: unknown): this {
    this.queue.push({ output });
    return this;
  }

  willFail(error: AiRunError): this {
    this.queue.push({ error });
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.queue.length = 0;
    this.defaultOutput = undefined;
  }

  async generateStructured<T>(req: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    this.calls.push({
      capability: req.capability,
      promptId: req.prompt.id,
      promptVersion: req.prompt.version,
      system: req.system,
      user: req.user,
      actor: req.actor,
    });

    const next: Scripted | undefined =
      this.queue.shift() ??
      (this.defaultOutput !== undefined ? { output: this.defaultOutput } : undefined);
    if (!next) throw new Error('FakeAiService: no scripted response for this call');
    if ('error' in next) throw next.error;

    const parsed = req.schema.safeParse(next.output);
    if (!parsed.success)
      throw new AiRunError('AI_INVALID_OUTPUT', { errorClass: 'NoObjectGeneratedError' });
    const verdict = req.postCheck?.(parsed.data) ?? 'ok';
    if (verdict !== 'ok') {
      throw new AiRunError('AI_INVALID_OUTPUT', { errorClass: 'PostCheckRejected' });
    }
    return { output: parsed.data, provider: 'fake', model: 'fake-model', attempt: 1 };
  }
}

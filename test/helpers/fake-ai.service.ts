import {
  AiRunError,
  AiService,
  type AiChatEvent,
  type AiChatOutcome,
  type AiChatRequest,
  type AiChatRun,
  type AiStructuredRequest,
  type AiStructuredResult,
} from '@common/ai/ai.service';

export interface FakeAiCall {
  capability: string;
  promptId: string;
  promptVersion: number;
  system: string;
  user: string;
  actor: { userId?: string; childId?: string };
  /** Chat calls only: what the model was sent, oldest first. */
  messages?: { role: 'user' | 'assistant'; content: string }[];
}

type Scripted = { output: unknown } | { error: AiRunError };

/** One scripted streamed chat reply. */
export interface FakeChatScript {
  /** Sent in order; empty strings are not skipped here, the real service drops them. */
  deltas: string[];
  /** How the provider ends the reply. Default `stop`. */
  finishReason?: 'stop' | 'length';
  /** Thrown once the deltas are out (before the first one when `deltas` is empty). */
  fail?: AiRunError;
  /** After the deltas, wait until the client leaves (the caller's signal), then end quietly. */
  hang?: boolean;
}

/**
 * In-memory AiService for e2e tests (same role as FakeEmailService). Scripted responses are
 * consumed in order; like the real service it validates the output against the request schema
 * and runs `postCheck`, so a test cannot pass by scripting something the pipeline would reject.
 * It never makes a network call and writes no `ai_runs` rows.
 */
export class FakeAiService extends AiService {
  readonly calls: FakeAiCall[] = [];
  private readonly queue: Scripted[] = [];
  private readonly chatQueue: FakeChatScript[] = [];
  /** The verdict passed to `finish()` for each chat run, in order. */
  readonly chatOutcomes: AiChatOutcome[] = [];
  /** How many hanging chat streams ended because the caller's signal fired. */
  chatAborts = 0;

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

  willStreamChat(script: FakeChatScript): this {
    this.chatQueue.push(script);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.queue.length = 0;
    this.chatQueue.length = 0;
    this.chatOutcomes.length = 0;
    this.chatAborts = 0;
    this.defaultOutput = undefined;
  }

  streamChat(req: AiChatRequest): AiChatRun {
    this.calls.push({
      capability: req.capability,
      promptId: req.prompt.id,
      promptVersion: req.prompt.version,
      system: req.system,
      user: req.messages[req.messages.length - 1]?.content ?? '',
      actor: req.actor,
      messages: req.messages,
    });
    const script = this.chatQueue.shift();
    if (!script) throw new Error('FakeAiService: no scripted chat reply for this call');

    return {
      events: this.scriptedChat(script, req),
      finish: async (outcome) => {
        this.chatOutcomes.push(outcome);
      },
    };
  }

  private async *scriptedChat(
    script: FakeChatScript,
    req: AiChatRequest,
  ): AsyncGenerator<AiChatEvent> {
    for (const text of script.deltas) {
      if (req.signal.aborted) return;
      yield { type: 'delta', text };
    }
    if (script.fail) throw script.fail;
    if (script.hang) {
      await new Promise<void>((resolve) => {
        if (req.signal.aborted) resolve();
        else req.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      this.chatAborts += 1;
      return;
    }
    yield { type: 'end', finishReason: script.finishReason ?? 'stop' };
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

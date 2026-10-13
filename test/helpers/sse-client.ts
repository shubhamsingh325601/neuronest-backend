export interface SseFrame {
  event: string;
  id?: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * A minimal server-sent-events client over `fetch`, for e2e tests against a really listening server.
 * `frames` holds the events in arrival order, `comments` the comment lines (heartbeats), `ended` is
 * true once the server closed the stream.
 */
export class SseClient {
  readonly frames: SseFrame[] = [];
  readonly comments: string[] = [];
  ended = false;

  private constructor(
    readonly status: number,
    private readonly response: Response,
    private readonly controller: AbortController,
  ) {}

  static async open(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
    const controller = new AbortController();
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream', ...headers },
      signal: controller.signal,
    });
    const client = new SseClient(response.status, response, controller);
    if (response.status === 200) void client.pump();
    return client;
  }

  /** The problem body of a refused connection. */
  async problem(): Promise<{ status: number; code?: string }> {
    return (await this.response.json()) as { status: number; code?: string };
  }

  events(name: string): SseFrame[] {
    return this.frames.filter((f) => f.event === name);
  }

  /** Message seqs received, in order. */
  seqs(): number[] {
    return this.events('message').map((f) => f.data.seq as number);
  }

  async waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error(
          `SseClient timed out; received ${JSON.stringify(this.frames.map((f) => f.event))}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  close(): void {
    this.controller.abort();
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      const reader = this.response.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          this.parse(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted by `close()`, or the connection dropped.
    }
    this.ended = true;
  }

  private parse(block: string): void {
    const frame: SseFrame = { event: 'message' };
    let hasField = false;
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) {
        this.comments.push(line.slice(1).trim());
      } else if (line.startsWith('event: ')) {
        frame.event = line.slice(7);
        hasField = true;
      } else if (line.startsWith('id: ')) {
        frame.id = line.slice(4);
        hasField = true;
      } else if (line.startsWith('data: ')) {
        frame.data = JSON.parse(line.slice(6));
        hasField = true;
      }
    }
    if (hasField) this.frames.push(frame);
  }
}

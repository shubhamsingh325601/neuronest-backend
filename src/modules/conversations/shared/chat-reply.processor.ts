import { OFF_TOPIC_MARKER } from './ai-chat.constants';
import { checkChatChunk } from './ai-chat-safety.filter';
import { endsWithSentenceEnd, SentenceSplitter } from './sentence-splitter';

/** How much of the previous piece is checked together with the next one. */
const TAIL_CHARS = 80;

export type ReplyAction =
  | { type: 'delta'; text: string }
  /** A piece failed the filter: stop reading, show the fixed safe text instead. */
  | { type: 'retract'; reason: string };

export type ReplyOutcome = 'COMPLETE' | 'REDIRECTED' | 'RETRACTED' | 'EMPTY';

type State = 'MARKER_CHECK' | 'ANSWER' | 'OFF_TOPIC' | 'RETRACTED';

/**
 * Turns the model's raw text deltas into what may be shown (plan 0019 sections 6.4 and 6.5). Pure:
 * no I/O, so the stream rules are testable without a provider.
 *
 * 1. The start of the reply is held while it could still become the off-topic marker. The marker arrives
 *    split across several deltas, so the rule is "still a prefix of the marker", not a fixed length.
 * 2. A normal answer is cut into sentences. Each piece, with the tail of the previous one, passes
 *    {@link checkChatChunk} before it is released.
 */
export class ChatReplyProcessor {
  private state: State = 'MARKER_CHECK';
  private held = '';
  private tail = '';
  private released = '';
  private readonly splitter = new SentenceSplitter();

  constructor(private readonly nameTokens: string[]) {}

  /** Everything released so far, which is what the parent has been shown. */
  get text(): string {
    return this.released;
  }

  push(text: string): ReplyAction[] {
    if (this.state === 'OFF_TOPIC' || this.state === 'RETRACTED') return [];
    if (this.state === 'MARKER_CHECK') {
      this.held += text;
      const trimmed = this.held.trim();
      if (trimmed.startsWith(OFF_TOPIC_MARKER)) {
        this.state = 'OFF_TOPIC';
        this.held = '';
        return [];
      }
      if (trimmed === '' || OFF_TOPIC_MARKER.startsWith(trimmed)) return [];
      this.state = 'ANSWER';
      const start = this.held.trimStart();
      this.held = '';
      return this.release(this.splitter.push(start));
    }
    return this.release(this.splitter.push(text));
  }

  /**
   * The provider ended the reply. A reply cut at the token limit loses its unfinished last fragment;
   * whole sentences already released stay (plan 0019 section 3 row 22).
   */
  end(finishReason: 'stop' | 'length'): ReplyAction[] {
    let actions: ReplyAction[] = [];
    if (this.state === 'MARKER_CHECK') {
      // Still a prefix of the marker when the stream ended: an answer, not a marker.
      const start = this.held.trim() === '' ? '' : this.held.trimStart();
      this.held = '';
      this.state = 'ANSWER';
      actions = this.release(this.splitter.push(start));
    }
    if (this.state === 'ANSWER') {
      const rest = this.splitter.flush();
      if (rest.trim() !== '' && (finishReason === 'stop' || endsWithSentenceEnd(rest))) {
        actions = [...actions, ...this.release([rest])];
      }
    }
    return actions;
  }

  get outcome(): ReplyOutcome {
    if (this.state === 'OFF_TOPIC') return 'REDIRECTED';
    if (this.state === 'RETRACTED') return 'RETRACTED';
    return this.released.trim() === '' ? 'EMPTY' : 'COMPLETE';
  }

  private release(pieces: string[]): ReplyAction[] {
    const actions: ReplyAction[] = [];
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (trimmed === '') {
        this.released += piece;
        continue;
      }
      const verdict = checkChatChunk(
        this.tail ? `${this.tail} ${trimmed}` : trimmed,
        this.nameTokens,
      );
      if (verdict !== 'ok') {
        this.state = 'RETRACTED';
        return [...actions, { type: 'retract', reason: verdict.reject }];
      }
      this.released += piece;
      this.tail = trimmed.slice(-TAIL_CHARS);
      actions.push({ type: 'delta', text: piece });
    }
    return actions;
  }
}

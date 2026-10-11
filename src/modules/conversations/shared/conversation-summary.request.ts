import { MessageSender } from '@prisma/client';
import type { AiStructuredRequest } from '@common/ai/ai.service';
import { truncate } from '@modules/ai-coaching/shared/text-safety.util';
import {
  conversationSummaryPromptV1 as prompt,
  type SummaryPromptMessage,
} from '@modules/conversations/prompts/conversation-summary.v1';
import {
  checkSummary,
  conversationSummarySchema,
  type ConversationSummaryOutput,
} from './conversation-summary.content';
import { redactPii, type NameGroup } from './pii-redaction';

export const SUMMARY_CAPABILITY = 'conversation-summary';

/** Room for the full JSON shape; the global default is sized for a coaching tip. */
export const SUMMARY_MAX_OUTPUT_TOKENS = 1000;
/** Per message, and for the whole transcript (the newest messages win). Bounds the prompt size. */
const MESSAGE_MAX_CHARS = 1000;
const TRANSCRIPT_MAX_CHARS = 30_000;

const FROM_SENDER: Record<MessageSender, SummaryPromptMessage['from']> = {
  [MessageSender.PARENT]: 'parent',
  [MessageSender.EXPERT]: 'expert',
  [MessageSender.AI]: 'assistant',
};

/** Keeps the newest messages that fit in the transcript budget. */
function limit(messages: SummaryPromptMessage[]): SummaryPromptMessage[] {
  let total = 0;
  const kept: SummaryPromptMessage[] = [];
  for (const message of [...messages].reverse()) {
    total += message.text.length;
    if (total > TRANSCRIPT_MAX_CHARS) break;
    kept.push(message);
  }
  return kept.reverse();
}

/**
 * The one definition of a summary request. The job and the live eval both send exactly this, so an
 * eval result describes what production does. The raw messages are name-scrubbed and PII-redacted
 * here; nothing else in the request carries conversation text.
 */
export function buildSummaryRequest(args: {
  kind: 'AI' | 'HUMAN';
  childId: string;
  names: NameGroup[];
  messages: { sender: MessageSender; body: string }[];
  maxOutputTokens: number;
}): AiStructuredRequest<ConversationSummaryOutput> {
  const transcript = limit(
    args.messages.map((m) => ({
      from: FROM_SENDER[m.sender],
      text: truncate(redactPii(m.body, args.names), MESSAGE_MAX_CHARS),
    })),
  );
  const nameTokens = args.names.flatMap((n) => n.tokens);
  const sourceTexts = transcript.map((m) => m.text);
  return {
    capability: SUMMARY_CAPABILITY,
    prompt: { id: prompt.id, version: prompt.version },
    system: prompt.system,
    user: prompt.buildUser(args.kind, transcript),
    schema: conversationSummarySchema,
    postCheck: (output) => checkSummary(output, { nameTokens, sourceTexts }),
    actor: { childId: args.childId },
    maxOutputTokens: args.maxOutputTokens,
  };
}

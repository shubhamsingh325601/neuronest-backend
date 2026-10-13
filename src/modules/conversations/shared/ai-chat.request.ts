import type { AiChatTopic, MessageSender } from '@prisma/client';
import type { AiChatRequest } from '@common/ai/ai.service';
import { truncate } from '@modules/ai-coaching/shared/text-safety.util';
import { chatPromptV2 as prompt } from '@modules/conversations/prompts/chat.v2';
import { CHAT_CAPABILITY, withoutFooter } from './ai-chat.constants';
import type { ChatPromptContext } from './ai-chat-context.builder';
import { redactPii, type NameGroup } from './pii-redaction';

export const chatPrompt = prompt;

/**
 * The one definition of a chat request. The send service and the live eval both send exactly this, so
 * an eval result describes what production does. Parent text is redacted here, and stored AI replies
 * lose their footer; nothing else in the request carries conversation text.
 */
export function buildChatRequest(args: {
  topic: AiChatTopic;
  context: ChatPromptContext;
  /** Oldest first, ending with the parent's new message. */
  history: { sender: MessageSender; body: string }[];
  names: NameGroup[];
  maxMessageChars: number;
  actor: { userId?: string; childId?: string };
  signal: AbortSignal;
  maxOutputTokens?: number;
}): AiChatRequest {
  const messages = args.history
    .filter((m) => m.sender === 'PARENT' || m.sender === 'AI')
    .map((m) =>
      m.sender === 'PARENT'
        ? {
            role: 'user' as const,
            content: truncate(redactPii(m.body, args.names), args.maxMessageChars),
          }
        : { role: 'assistant' as const, content: withoutFooter(m.body) },
    );
  // The model must start with the parent: a window can begin on one of its own earlier replies.
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();

  return {
    capability: CHAT_CAPABILITY,
    prompt: { id: prompt.id, version: prompt.version },
    system: prompt.buildSystem(args.topic, args.context),
    messages,
    actor: args.actor,
    maxOutputTokens: args.maxOutputTokens,
    signal: args.signal,
  };
}

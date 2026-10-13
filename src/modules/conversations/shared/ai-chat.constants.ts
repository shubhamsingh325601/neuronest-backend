import { AiChatTopic } from '@prisma/client';

export const CHAT_CAPABILITY = 'chat-reply';

export type ChatTopicKind = 'AI' | 'ROUTE' | 'UNAVAILABLE';

export interface ChatTopic {
  /** An {@link AiChatTopic} for `AI` entries; a plain id for the entries that are not an AI chat. */
  id: string;
  label: string;
  description: string;
  kind: ChatTopicKind;
}

/**
 * The guided topic list (plan 0019 section 6.1). Code, not data: the topic fixes the prompt fragment and
 * the context allow-list, so it must not be editable at runtime. Bump the version with any change.
 * Wording is product copy and may change.
 */
export const AI_CHAT_TOPICS_VERSION = 1;

export const AI_CHAT_TOPICS: readonly ChatTopic[] = [
  {
    id: AiChatTopic.TODAYS_ACTIVITIES,
    label: "Today's activities",
    description:
      "Get help doing today's activity, making it easier or shorter, and what to expect.",
    kind: 'AI',
  },
  {
    id: AiChatTopic.PLAN_EXPLAINER,
    label: "My child's plan, explained",
    description: 'What the plan, its weeks and its goals mean, in plain words.',
    kind: 'AI',
  },
  {
    id: AiChatTopic.RECENT_PROGRESS,
    label: 'Recent progress',
    description: "A plain-language recap of last week's logged progress.",
    kind: 'AI',
  },
  {
    id: AiChatTopic.EVERYDAY_ROUTINES,
    label: 'Everyday routines',
    description: 'General ideas for sleep, meals and transitions that stay within the plan.',
    kind: 'AI',
  },
  {
    id: 'BOOK_CALL',
    label: 'Book a call',
    description: "Book a call with your child's clinician.",
    kind: 'ROUTE',
  },
  {
    id: 'TALK_TO_EXPERT',
    label: 'Talk to an expert',
    description: 'Chat with a person who can help.',
    kind: 'ROUTE',
  },
  {
    id: 'AI_ASSESSMENT',
    label: 'AI assessment',
    description: 'Coming soon.',
    kind: 'UNAVAILABLE',
  },
];

export const AI_CHAT_TOPIC_IDS: string[] = AI_CHAT_TOPICS.map((t) => t.id);

export function findChatTopic(id: string): ChatTopic | undefined {
  return AI_CHAT_TOPICS.find((t) => t.id === id);
}

/** The model is told to begin its whole reply with this when the message is outside the topic. */
export const OFF_TOPIC_MARKER = '[[OFF_TOPIC]]';

/** Shown instead of an off-topic reply. Fixed text: the model's own words are never used. */
export const OFF_TOPIC_REDIRECT =
  "I can only help with your child's care and the topic you picked. Please pick a topic from the list to continue.";

/** Stored and sent in place of a reply that failed the safety filter. */
export const RETRACTED_REPLY =
  "I can't help with that here. For a question like this, please talk to your child's expert or book a call.";

/** Appended by code to every completed reply (plan 0019 section 6.2 rule 8). Bump the version with any change. */
export const AI_CHAT_FOOTER_VERSION = 1;
export const AI_CHAT_FOOTER =
  "This is AI guidance, not a diagnosis. For decisions about your child's care, please talk to your child's expert or clinician.";

export function withFooter(text: string): string {
  return `${text.trimEnd()}\n\n${AI_CHAT_FOOTER}`;
}

/** The text of a stored AI reply without the footer, for the history sent back to the model. */
export function withoutFooter(body: string): string {
  return body.endsWith(AI_CHAT_FOOTER) ? body.slice(0, -AI_CHAT_FOOTER.length).trimEnd() : body;
}

/**
 * Shown when the model marked a plain greeting, thanks or "who am I" as off-topic anyway (plan 0019 section 14).
 * A strike is for leaving the topic, not for saying hello. Fixed text, one per picked topic label.
 */
export function smallTalkReply(topicId: string): string {
  const label = findChatTopic(topicId)?.label.toLowerCase() ?? 'your child';
  return `Hello! I'm an AI assistant in this app. I can't see names, but I'm here to help you, the parent, with ${label}. What would you like to ask?`;
}

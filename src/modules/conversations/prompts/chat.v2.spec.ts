import { AiChatTopic } from '@prisma/client';
import { sha256 } from '@common/crypto/token.util';
import { OFF_TOPIC_MARKER } from '@modules/conversations/shared/ai-chat.constants';
import { chatPrompt } from '@modules/conversations/shared/ai-chat.request';
import { chatPromptV1 } from './chat.v1';
import { chatPromptV2 as prompt } from './chat.v2';

/** Add rows, never rewrite them (see chat.v1.spec). Version 2 needs clinician sign-off (launch gate G3). */
const SHIPPED: Record<number, string> = {
  2: 'af2dd9878d7615e55605a46f20b27cafb69139a1a6d0d9368e2c39e7d9ed0f42',
};

describe('chat prompt v2', () => {
  it('is the version requests are made with, and keeps the chat-reply identity', () => {
    expect(prompt.id).toBe('chat-reply');
    expect(prompt.version).toBe(2);
    expect(chatPrompt).toBe(prompt);
  });

  it('exports the hash of its rules and topic fragments, and the version is pinned', () => {
    const text = [prompt.rules, ...Object.values(prompt.topicFragments)].join('\n');
    expect(sha256(text)).toBe(prompt.promptHash);
    expect(SHIPPED[prompt.version]).toBe(prompt.promptHash);
    expect(prompt.promptHash).not.toBe(chatPromptV1.promptHash);
  });

  it('keeps the topic fragments of version 1 and every clinical rule (1-4 and 6-9) word for word', () => {
    expect(prompt.topicFragments).toEqual(chatPromptV1.topicFragments);
    const numbered = (rules: string) =>
      Object.fromEntries(
        rules
          .split('\n')
          .map((l) => /^(\d+)\. (.*)$/.exec(l))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => [Number(m[1]), m[2]]),
      );
    const v1 = numbered(chatPromptV1.rules);
    const v2 = numbered(prompt.rules);
    for (const n of [1, 2, 3, 4, 6, 7, 8, 9]) expect(v2[n]).toBe(v1[n]);
  });

  it('no longer lists chit-chat as off-topic, and makes greetings and "who am I" part of the topic', () => {
    expect(chatPromptV1.rules).toMatch(/chit-chat\) reply with exactly/);
    expect(prompt.rules).not.toContain('chit-chat');
    expect(prompt.rules).toContain(`reply with exactly ${OFF_TOPIC_MARKER}`);
    expect(prompt.rules).toMatch(/greeting, a thank-you/);
    expect(prompt.rules).toMatch(/who the parent is, who their child is/);
    expect(prompt.rules).toContain(`Do not use ${OFF_TOPIC_MARKER} for these`);
  });

  it('still builds the rules, the topic and the context into one system prompt', () => {
    const system = prompt.buildSystem(AiChatTopic.EVERYDAY_ROUTINES, {
      ageYears: 6,
      planDay: null,
      planOverview: { sections: [], days: [] },
    });
    expect(system).toContain(prompt.rules);
    expect(system).toContain(prompt.topicFragments.EVERYDAY_ROUTINES);
    expect(system).toContain('<plan_day>none</plan_day>');
  });
});

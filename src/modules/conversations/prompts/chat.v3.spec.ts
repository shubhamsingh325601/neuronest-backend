import { AiChatTopic } from '@prisma/client';
import { sha256 } from '@common/crypto/token.util';
import { OFF_TOPIC_MARKER } from '@modules/conversations/shared/ai-chat.constants';
import { chatPrompt } from '@modules/conversations/shared/ai-chat.request';
import { chatPromptV1 } from './chat.v1';
import { chatPromptV2 } from './chat.v2';
import { chatPromptV3 as prompt } from './chat.v3';

/**
 * Add rows, never rewrite them (see chat.v1.spec). Version 3 needs clinician sign-off (launch gate G3): its rules
 * were changed by an engineer and have NOT been reviewed by a clinician yet.
 */
const SHIPPED: Record<number, string> = {
  3: 'ec0ce95afe98df2c6e8005569ab0237b74c92d1a86b8ff9b4bb147edda1e7524',
};

const numbered = (rules: string) =>
  Object.fromEntries(
    rules
      .split('\n')
      .map((l) => /^(\d+)\. (.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [Number(m[1]), m[2]]),
  );

describe('chat prompt v3', () => {
  it('is the version requests are made with, and keeps the chat-reply identity', () => {
    expect(prompt.id).toBe('chat-reply');
    expect(prompt.version).toBe(3);
    expect(chatPrompt).toBe(prompt);
  });

  it('exports the hash of its rules and topic fragments, and the version is pinned', () => {
    const text = [prompt.rules, ...Object.values(prompt.topicFragments)].join('\n');
    expect(sha256(text)).toBe(prompt.promptHash);
    expect(SHIPPED[prompt.version]).toBe(prompt.promptHash);
    expect(prompt.promptHash).not.toBe(chatPromptV1.promptHash);
    expect(prompt.promptHash).not.toBe(chatPromptV2.promptHash);
  });

  it('keeps rules 1-3, 7 and 9 of version 1 word for word, and rule 5 of version 2', () => {
    const v1 = numbered(chatPromptV1.rules);
    const v2 = numbered(chatPromptV2.rules);
    const v3 = numbered(prompt.rules);
    for (const n of [1, 2, 3, 7, 9]) expect(v3[n]).toBe(v1[n]);
    expect(v3[5]).toBe(v2[5]);
  });

  it('uses the first names, allows plain lists and writes UK English', () => {
    const rules = numbered(prompt.rules);
    expect(prompt.rules).not.toMatch(/cannot see names|Say "your child"/);
    expect(rules[6]).toContain('first names in <family>');
    expect(rules[6]).toContain('Never ask for any other personal detail');
    expect(rules[8]).toContain('"- "');
    expect(rules[8]).toContain('"1. "');
    expect(rules[8]).toContain('at most 5 lines');
    expect(rules[8]).toContain('the app adds it');
    expect(rules[10]).toContain(`Do not use ${OFF_TOPIC_MARKER} for these`);
    expect(rules[11]).toContain('UK English');
    expect(rules[12]).toContain('only from <plan_day> and <plan_overview>');
  });

  it('builds the rules, the topic and the family block into one system prompt', () => {
    const system = prompt.buildSystem(AiChatTopic.EVERYDAY_ROUTINES, {
      ageYears: 6,
      family: { parentName: 'Meera', childName: 'Zeph', gender: 'Female' },
      planDay: null,
      planOverview: { sections: [], days: [] },
      profile: { calmingPreferences: ['Deep pressure: <b>a firm hug</b>'] },
    });
    expect(system).toContain(prompt.rules);
    expect(system).toContain(prompt.topicFragments.EVERYDAY_ROUTINES);
    expect(system).toContain('<parent_name>Meera</parent_name>');
    expect(system).toContain('<child_name>Zeph</child_name>');
    expect(system).toContain('<plan_day>none</plan_day>');
    expect(system).toContain(
      '<calming_preference>Deep pressure: &lt;b&gt;a firm hug&lt;/b&gt;</calming_preference>',
    );
  });

  it('puts the day instructions in the plan overview only when the context has them', () => {
    const system = prompt.buildSystem(AiChatTopic.PLAN_EXPLAINER, {
      ageYears: null,
      family: { parentName: 'Meera', childName: 'Zeph', gender: null },
      planOverview: {
        sections: ['Week 1'],
        days: [
          { dayNumber: 1, title: 'Wind down', instructions: 'Dim the lights.' },
          { dayNumber: 2, title: 'Story time' },
        ],
      },
      profile: { currentStage: 'Building routines' },
    });
    expect(system).toContain(
      '<day number="1"><title>Wind down</title><instructions>Dim the lights.</instructions></day>',
    );
    expect(system).toContain('<day number="2">Story time</day>');
    expect(system).toContain('<current_stage>Building routines</current_stage>');
    expect(system).not.toContain('<child_gender>');
  });
});

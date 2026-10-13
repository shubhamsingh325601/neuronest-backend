import { sha256 } from '@common/crypto/token.util';
import type { CoachingPromptContext } from '@modules/ai-coaching/shared/coaching-context.builder';
import { coachingTipPrompt } from '@modules/ai-coaching/shared/coaching-tip.request';
import { coachingTipPromptV2 } from './coaching-tip.v2';
import { coachingTipPromptV3 as prompt } from './coaching-tip.v3';

const ctx: CoachingPromptContext = {
  ageYears: 6,
  planDay: { dayNumber: 3, title: 'Bedtime routine', instructions: 'Dim the lights.' },
  lastWeek: { daysLogged: 4, sleepMinutesAverage: 480 },
  clinicianTips: [{ title: 'Calm start', body: 'Use a visual timer.' }],
};

describe('coaching-tip prompt v3', () => {
  it('has a stable identity, and is the version requests are made with', () => {
    expect(prompt.id).toBe('coaching-tip');
    expect(prompt.version).toBe(3);
    expect(coachingTipPrompt).toBe(prompt);
    expect(sha256(prompt.system)).toBe(prompt.promptHash);
  });

  it('keeps rules 1-10 and the output format of v2 word for word, and adds rules 11 and 12', () => {
    const rules = (text: string) => text.slice(text.indexOf('<rules>'), text.indexOf('</rules>'));
    const v2Rules = rules(coachingTipPromptV2.system).trimEnd();
    expect(rules(prompt.system).startsWith(v2Rules)).toBe(true);
    expect(rules(prompt.system)).toContain('\n11. <recent_chat_themes>');
    expect(rules(prompt.system)).toContain('\n12. If <follow_up_suggested>');
    expect(prompt.system.slice(prompt.system.indexOf('<output_format>'))).toBe(
      coachingTipPromptV2.system.slice(coachingTipPromptV2.system.indexOf('<output_format>')),
    );
  });

  it('forbids mentioning chats and bars new advice on a chat topic', () => {
    expect(prompt.system).toContain('Never mention chats, conversations');
    expect(prompt.system).toContain('never add advice on a topic the clinician did not cover');
  });

  it('builds the same user message as v2 when there are no recent chats', () => {
    expect(prompt.buildUser(ctx)).toBe(coachingTipPromptV2.buildUser(ctx));
  });

  it('adds the themes and follow-up flag inside <context> when there are recent chats', () => {
    const user = prompt.buildUser({
      ...ctx,
      recentChats: { themes: ['sleep', 'routines'], followUpSuggested: true },
    });

    expect(user).toContain('<recent_chat_themes>sleep, routines</recent_chat_themes>');
    expect(user).toContain('<follow_up_suggested>true</follow_up_suggested>');
    expect(user.indexOf('<recent_chat_themes>')).toBeLessThan(user.indexOf('</context>'));
    expect(user.indexOf('</clinician_tips>')).toBeLessThan(user.indexOf('<recent_chat_themes>'));
    expect(user.indexOf('<task>')).toBeGreaterThan(user.indexOf('</context>'));
  });
});

import { AiChatTopic, MessageSender } from '@prisma/client';
import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { AI_CHAT_FOOTER, withFooter } from './ai-chat.constants';
import { buildChatRequest } from './ai-chat.request';

const signal = new AbortController().signal;
const names = [
  { tokens: nameTokens('Zephyrine Rao'), placeholder: 'the child' },
  { tokens: nameTokens('Meera Rao'), placeholder: 'the parent' },
];

function build(history: { sender: MessageSender; body: string }[], maxMessageChars = 1000) {
  return buildChatRequest({
    topic: AiChatTopic.TODAYS_ACTIVITIES,
    context: { ageYears: 6, planDay: null },
    history,
    names,
    maxMessageChars,
    actor: { userId: 'u1', childId: 'c1' },
    signal,
    maxOutputTokens: 400,
  });
}

describe('buildChatRequest', () => {
  it('names the capability and prompt, and passes the signal and limits through', () => {
    const req = build([{ sender: MessageSender.PARENT, body: 'Hello' }]);

    expect(req).toMatchObject({
      capability: 'chat-reply',
      prompt: { id: 'chat-reply', version: 1 },
      actor: { userId: 'u1', childId: 'c1' },
      maxOutputTokens: 400,
      signal,
    });
    expect(req.system).toContain('<topic>');
  });

  it('redacts names, emails, links and numbers in the parent text', () => {
    const req = build([
      {
        sender: MessageSender.PARENT,
        body: 'Zephyrine and Meera: mail me at a.b@example.com then see https://x.example.org then call 98765 43210 and id 123456',
      },
    ]);

    expect(req.messages).toEqual([
      {
        role: 'user',
        content:
          'the child and the parent: mail me at an email address then see a link then call a phone number and id a number',
      },
    ]);
  });

  it('strips the footer from earlier AI replies and keeps the roles', () => {
    const req = build([
      { sender: MessageSender.PARENT, body: 'Question one' },
      { sender: MessageSender.AI, body: withFooter('Answer one.') },
      { sender: MessageSender.PARENT, body: 'Question two' },
    ]);

    expect(req.messages).toEqual([
      { role: 'user', content: 'Question one' },
      { role: 'assistant', content: 'Answer one.' },
      { role: 'user', content: 'Question two' },
    ]);
    expect(JSON.stringify(req.messages)).not.toContain(AI_CHAT_FOOTER);
  });

  it('starts with the parent when the history window begins on an AI reply', () => {
    const req = build([
      { sender: MessageSender.AI, body: 'An old reply.' },
      { sender: MessageSender.PARENT, body: 'Question' },
    ]);

    expect(req.messages).toEqual([{ role: 'user', content: 'Question' }]);
  });

  it('cuts a long parent message and leaves expert messages out', () => {
    const req = build(
      [
        { sender: MessageSender.EXPERT, body: 'Should never be here' },
        { sender: MessageSender.PARENT, body: 'y'.repeat(50) },
      ],
      10,
    );

    expect(req.messages).toEqual([{ role: 'user', content: 'y'.repeat(10) }]);
  });
});

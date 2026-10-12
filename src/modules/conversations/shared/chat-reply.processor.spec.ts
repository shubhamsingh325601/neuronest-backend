import { ChatReplyProcessor, type ReplyAction } from './chat-reply.processor';

/** Feeds the deltas in order, then ends the reply, and returns every action produced. */
function run(
  deltas: string[],
  finish: 'stop' | 'length' = 'stop',
  names: string[] = ['Zephyrine'],
): { actions: ReplyAction[]; processor: ChatReplyProcessor } {
  const processor = new ChatReplyProcessor(names);
  const actions: ReplyAction[] = [];
  for (const delta of deltas) actions.push(...processor.push(delta));
  actions.push(...processor.end(finish));
  return { actions, processor };
}

const shown = (actions: ReplyAction[]) =>
  actions.flatMap((a) => (a.type === 'delta' ? [a.text] : [])).join('');

describe('ChatReplyProcessor', () => {
  describe('off-topic marker (prefix rule)', () => {
    it('sees the marker even when it arrives one character at a time', () => {
      const { actions, processor } = run([...'[[OFF_TOPIC]]']);

      expect(actions).toEqual([]);
      expect(processor.outcome).toBe('REDIRECTED');
      expect(processor.text).toBe('');
    });

    it('ignores leading whitespace and anything the model adds after the marker', () => {
      const { actions, processor } = run(['\n ', '[[OFF_', 'TOPIC]] Sure, here is the news. ']);

      expect(actions).toEqual([]);
      expect(processor.outcome).toBe('REDIRECTED');
    });

    it('releases the held start as soon as the text stops being a prefix of the marker', () => {
      const { actions, processor } = run(['[', 'Try one thing. ', 'Then rest.']);

      expect(processor.outcome).toBe('COMPLETE');
      expect(shown(actions)).toBe('[Try one thing. Then rest.');
    });

    it('treats a stream that ends while still a prefix as an answer', () => {
      const { actions, processor } = run(['[[OFF']);

      expect(processor.outcome).toBe('COMPLETE');
      expect(shown(actions)).toBe('[[OFF');
    });

    it('treats an empty or whitespace-only reply as empty', () => {
      expect(run([]).processor.outcome).toBe('EMPTY');
      expect(run(['  \n']).processor.outcome).toBe('EMPTY');
    });

    it('does not look for the marker later in an answer', () => {
      const { processor } = run(['Here is an idea. ', '[[OFF_TOPIC]] ', 'Another idea.']);

      expect(processor.outcome).toBe('COMPLETE');
    });
  });

  describe('sentence release', () => {
    it('releases whole sentences, however the deltas are cut, and the text matches what was shown', () => {
      const { actions, processor } = run([
        'Start with one small ',
        'step. Keep it ',
        'calm. ',
        'Stop early.',
      ]);

      expect(actions.every((a) => a.type === 'delta')).toBe(true);
      expect(shown(actions)).toBe('Start with one small step. Keep it calm. Stop early.');
      expect(processor.text).toBe(shown(actions));
      expect(processor.outcome).toBe('COMPLETE');
    });

    it('drops the unfinished last fragment of a reply cut at the token limit', () => {
      const { actions, processor } = run(['One idea. ', 'Another idea. ', 'An unfinis'], 'length');

      expect(shown(actions)).toBe('One idea. Another idea. ');
      expect(processor.outcome).toBe('COMPLETE');
    });

    it('keeps a last fragment that is a whole sentence when cut at the token limit', () => {
      const { actions } = run(['One idea. ', 'Another idea.'], 'length');

      expect(shown(actions)).toBe('One idea. Another idea.');
    });

    it('is empty when a reply cut at the token limit has no whole sentence', () => {
      expect(run(['A very long sentence that never fini'], 'length').processor.outcome).toBe(
        'EMPTY',
      );
    });

    it('keeps an unfinished last fragment when the model stopped on its own', () => {
      expect(shown(run(['Two words'], 'stop').actions)).toBe('Two words');
    });
  });

  describe('safety filter', () => {
    it('retracts at the first bad sentence and releases nothing more', () => {
      const { actions, processor } = run([
        'That sounds hard. ',
        'A dose of melatonin might help. ',
        'Try a story.',
      ]);

      expect(actions).toEqual([
        { type: 'delta', text: 'That sounds hard. ' },
        { type: 'retract', reason: 'MEDICATION' },
      ]);
      expect(processor.outcome).toBe('RETRACTED');
      expect(processor.push('More text. ')).toEqual([]);
    });

    it('retracts a name, a link, a clinician claim and a diagnosis', () => {
      const bad = [
        ['Zephyrine can try this. ', 'NAME_LEAK'],
        ['Visit www.example.com. ', 'URL'],
        ['As your doctor, I suggest rest. ', 'CLAIMS_CLINICIAN'],
        ['Your child has autism. ', 'DIAGNOSIS'],
      ];
      for (const [text, reason] of bad) {
        const { actions } = run(['Fine start. ', text, 'Okay. ']);
        expect(actions[actions.length - 1]).toEqual({ type: 'retract', reason });
      }
    });

    it('catches a phrase that a forced cut splits between two pieces', () => {
      // 236 characters with no sentence end, then "will": the piece is cut right after "will".
      const first = `${'x '.repeat(118)}will `;
      const { actions } = run([first, 'definitely work. ']);

      expect(actions).toEqual([
        { type: 'delta', text: first },
        { type: 'retract', reason: 'PROMISE' },
      ]);
    });

    it('checks the last fragment at the end of the reply too', () => {
      const { actions, processor } = run(['A calm start. ', 'Give a vitamin']);

      expect(actions[actions.length - 1]).toEqual({ type: 'retract', reason: 'MEDICATION' });
      expect(processor.outcome).toBe('RETRACTED');
    });
  });
});

import { isSmallTalk } from './small-talk';

describe('isSmallTalk', () => {
  it.each([
    'hi',
    'Hi!',
    'hiii',
    'Hello there',
    'hey',
    'Namaste',
    'good morning',
    'thanks',
    'Thank you!',
    'ok thanks',
    'who am I',
    'Who am I?',
    'who is my child?',
    "who's my son",
    'what is my name',
    'who are you',
    'what can you do?',
    'main kaun hu',
  ])('treats "%s" as small talk', (text) => {
    expect(isSmallTalk(text)).toBe(true);
  });

  it.each([
    '',
    'hi, tell me the news',
    'who is the prime minister',
    'who am I to argue with the clinician about bedtime',
    'what should I do today',
    'hello can you give melatonin',
    'Hi '.repeat(20),
  ])('does not treat "%s" as small talk', (text) => {
    expect(isSmallTalk(text)).toBe(false);
  });
});

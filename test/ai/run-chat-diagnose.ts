import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { AiChatTopic } from '@prisma/client';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { chatThinking } from '@common/ai/thinking-options';
import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { assembleChatContext } from '@modules/conversations/shared/ai-chat-context.builder';
import { buildChatRequest } from '@modules/conversations/shared/ai-chat.request';
import { ChatReplyProcessor } from '@modules/conversations/shared/chat-reply.processor';

/**
 * Manual timing probe for the guided chat against the real provider:
 * `AI_DIAG_LIVE=1 [AI_KEY_FILE=path] [AI_DIAG_MODELS=a,b] npm run ai:diagnose:chat -- "hi" "who am I"`.
 *
 * Calls the SDK directly (the app's port hides finishReason and reasoning tokens) with the same request the app
 * builds and the same timeouts. Per message and thinking variant it prints time to first part / first text,
 * the longest gap between parts (the chunk timeout fires on that), finishReason, token usage including thinking,
 * and what the reply processor makes of the text. Synthetic data only. The key is read from the environment or
 * from `AI_KEY_FILE` and is never printed.
 */

const VARIANTS: Record<string, Record<string, unknown> | undefined> = {
  default: undefined,
  /** What the app sends (`chatThinking`). */
  app: undefined,
  'level=minimal': { thinkingConfig: { thinkingLevel: 'minimal' } },
  'level=low': { thinkingConfig: { thinkingLevel: 'low' } },
  'budget=0': { thinkingConfig: { thinkingBudget: 0 } },
  'budget=128': { thinkingConfig: { thinkingBudget: 128 } },
};

const MESSAGES = [
  'hi',
  'who am I',
  'what should I do today',
  "Tell me today's news headlines.",
  'Should I give my child melatonin to sleep?',
];

const RAW = {
  childName: 'Zephyrine Rao',
  ageYears: 6,
  planDay: {
    dayNumber: 3,
    title: 'Bedtime routine',
    instructions: 'Dim the lights ten minutes earlier, then read one short story together.',
  },
  planSections: ['Week 1: Settling in', 'Week 2: Building routines'],
  planDays: [{ dayNumber: 3, title: 'Bedtime routine' }],
  daysLogged: 4,
  sleepMinutesAverage: 495,
  themes: ['sleep'],
};

function loadKey(): void {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return;
  const file = process.env.AI_KEY_FILE;
  if (!file) throw new Error('Set GOOGLE_GENERATIVE_AI_API_KEY or AI_KEY_FILE');
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^(key|GOOGLE_GENERATIVE_AI_API_KEY)\s*=/i.test(l));
  const value = line?.slice(line.indexOf('=') + 1).trim();
  if (!value) throw new Error('No key line in AI_KEY_FILE');
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = value;
}

const ms = (n: number): string => `${Math.round(n)}`.padStart(6);

async function probe(modelId: string, variant: string, message: string): Promise<void> {
  const built = assembleChatContext(AiChatTopic.TODAYS_ACTIVITIES, RAW);
  const names = [{ tokens: nameTokens('Zephyrine Rao'), placeholder: 'the child' }];
  const req = buildChatRequest({
    topic: AiChatTopic.TODAYS_ACTIVITIES,
    context: built.context,
    history: [{ sender: 'PARENT', body: message }],
    names,
    maxMessageChars: 1000,
    actor: {},
    signal: new AbortController().signal,
    maxOutputTokens: 400,
  });
  const google = createGoogleGenerativeAI();
  const app = variant === 'app' ? chatThinking('google', modelId) : undefined;
  const started = performance.now();
  let firstPart = -1;
  let firstText = -1;
  let last = started;
  let maxGap = 0;
  let finishReason = '?';
  let raw = '?';
  let usage = '';
  let text = '';
  let failure = '';
  const types = new Map<string, number>();
  const processor = new ChatReplyProcessor(built.nameTokens);
  try {
    const result = streamText({
      model: google.languageModel(modelId),
      system: req.system,
      messages: req.messages,
      maxRetries: 0,
      timeout:
        process.env.AI_DIAG_PROD_TIMEOUTS === '1'
          ? { chunkMs: 10000, totalMs: 60000 } // what the app uses
          : { chunkMs: 90000, totalMs: 120000 }, // wide on purpose: measure, do not cut
      maxOutputTokens: 400 + (app?.headroomTokens ?? 0),
      providerOptions: app
        ? app.providerOptions
        : VARIANTS[variant]
          ? { google: VARIANTS[variant] as never }
          : undefined,
      onError: ({ error }) => {
        const e = error as { name?: string; statusCode?: number };
        failure = `${e.name ?? 'Error'}:${e.statusCode ?? ''}`;
      },
    });
    for await (const part of result.fullStream) {
      const now = performance.now();
      if (firstPart < 0) firstPart = now - started;
      maxGap = Math.max(maxGap, now - last);
      last = now;
      types.set(part.type, (types.get(part.type) ?? 0) + 1);
      if (part.type === 'text-delta' && part.text.length > 0) {
        if (firstText < 0) firstText = now - started;
        text += part.text;
        processor.push(part.text);
      } else if (part.type === 'finish') {
        finishReason = part.finishReason;
        raw = part.rawFinishReason ?? '?';
        const u = part.totalUsage;
        usage = `in ${u.inputTokens} out ${u.outputTokens} think ${u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens ?? '?'} total ${u.totalTokens}`;
      }
    }
    if (finishReason === 'stop' || finishReason === 'length') {
      processor.end(finishReason);
    }
  } catch (err) {
    failure = failure || `${(err as Error).name}`;
  }
  const total = performance.now() - started;
  const marker = text.trim().startsWith('[[OFF_TOPIC]]');
  console.log(
    `${variant.padEnd(13)} "${message.slice(0, 28)}"`.padEnd(48) +
      ` first-part ${ms(firstPart)}  first-text ${ms(firstText)}  max-gap ${ms(maxGap)}  total ${ms(total)}` +
      `  finish ${finishReason}/${raw}  ${usage}  textLen ${text.length}  marker ${marker}` +
      `  processor ${processor.outcome}  parts ${[...types].map(([k, v]) => `${k}×${v}`).join(',')}` +
      (failure ? `  FAIL ${failure}` : '') +
      (process.env.AI_DIAG_SHOW === '1' ? `\n    text: ${JSON.stringify(text.slice(0, 160))}` : ''),
  );
}

async function main(): Promise<void> {
  if (process.env.AI_DIAG_LIVE !== '1') {
    console.log('Set AI_DIAG_LIVE=1 to call the provider.');
    return;
  }
  if (process.env.CI) throw new Error('Refusing to run live in CI');
  loadKey();
  const models = (process.env.AI_DIAG_MODELS ?? 'gemini-3.5-flash-lite').split(',');
  const variants = (process.env.AI_DIAG_VARIANTS ?? 'default').split(',');
  const argv = process.argv.slice(2);
  const messages = argv.length > 0 ? argv : MESSAGES;
  for (const model of models) {
    console.log(`\n== ${model}`);
    for (const variant of variants) {
      for (const message of messages) {
        await probe(model, variant, message);
        await sleep(Number(process.env.AI_EVAL_DELAY_MS ?? 1500));
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(`ai:diagnose:chat failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConversationKind, ConversationStatus, SummaryStatus } from '@prisma/client';
import { AiRunError, AiService } from '@common/ai/ai.service';
import { JobHandlerRegistry, type JobContext } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';
import { SUMMARISE_JOB } from './conversation-summary.queue';
import { ConversationSummaryJobs } from './conversation-summary.jobs';

const goodOutput = {
  overview: 'The parent described broken sleep and the expert suggested a calmer routine.',
  themes: ['sleep'],
  parentConcerns: ['Wakes often at night'],
  guidanceGiven: ['Keep the evening steps the same'],
  openQuestions: [],
  followUpSuggested: false,
};

describe('ConversationSummaryJobs', () => {
  const prisma = {
    conversation: { findUnique: jest.fn() },
    message: { findMany: jest.fn() },
    clinicianChildAssignment: { findMany: jest.fn() },
    conversationSummary: { updateMany: jest.fn(), createMany: jest.fn() },
  };
  const ai = { generateStructured: jest.fn() };
  let jobs: ConversationSummaryJobs;
  let registry: JobHandlerRegistry;

  const job = (payload: unknown = { conversationId: 'c-1' }): JobContext => ({
    id: 'j-1',
    type: SUMMARISE_JOB,
    payload: payload as JobContext['payload'],
    attempt: 1,
  });
  const conversation = (patch: Record<string, unknown> = {}) => ({
    id: 'c-1',
    kind: ConversationKind.HUMAN,
    childId: 'child-1',
    status: ConversationStatus.CLOSED,
    messagesPurgedAt: null,
    child: { name: 'Zorya Quill' },
    parent: { name: 'Meera Rao' },
    expert: { name: 'Dev Anand' },
    summary: { status: SummaryStatus.PENDING },
    ...patch,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.conversation.findUnique.mockResolvedValue(conversation());
    prisma.message.findMany.mockResolvedValue([
      { sender: 'PARENT', body: 'Zorya wakes up a lot, call me on 98765 43210' },
      { sender: 'EXPERT', body: 'Thanks Meera, try a calm routine.' },
    ]);
    prisma.clinicianChildAssignment.findMany.mockResolvedValue([
      { clinician: { name: 'Isha Verma' } },
    ]);
    ai.generateStructured.mockResolvedValue({
      output: goodOutput,
      provider: 'google',
      model: 'm',
      attempt: 1,
    });
    registry = new JobHandlerRegistry();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationSummaryJobs,
        { provide: PrismaService, useValue: prisma },
        { provide: JobHandlerRegistry, useValue: registry },
        { provide: AiService, useValue: ai },
        { provide: ConfigService, useValue: { get: () => ({ maxOutputTokens: 700 }) } },
      ],
    }).compile();
    jobs = moduleRef.get(ConversationSummaryJobs);
    jobs.onModuleInit();
  });

  it('registers the handler', () => {
    expect(registry.has(SUMMARISE_JOB)).toBe(true);
  });

  it('stores a READY summary with the kind added by code, as a system actor', async () => {
    await jobs.summarise(job());

    const request = ai.generateStructured.mock.calls[0][0];
    expect(request.capability).toBe('conversation-summary');
    expect(request.actor).toEqual({ childId: 'child-1' });
    expect(request.maxOutputTokens).toBe(1000);
    expect(prisma.conversationSummary.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.conversationSummary.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      conversationId: 'c-1',
      status: { in: [SummaryStatus.PENDING, SummaryStatus.FAILED] },
    });
    expect(call.data).toMatchObject({
      status: SummaryStatus.READY,
      content: { ...goodOutput, participantsKind: 'HUMAN' },
      provider: 'google',
      model: 'm',
      promptVersion: 1,
      failureReason: null,
    });
  });

  it('only sends name-scrubbed and PII-redacted text to the model', async () => {
    await jobs.summarise(job());
    const { user } = ai.generateStructured.mock.calls[0][0];
    expect(user).toContain('the child wakes up a lot, call me on a phone number');
    expect(user).toContain('Thanks the parent, try a calm routine.');
    for (const leaked of ['Zorya', 'Meera', '98765']) expect(user).not.toContain(leaked);
  });

  it('asks the model only about COMPLETE messages', async () => {
    await jobs.summarise(job());
    expect(prisma.message.findMany.mock.calls[0][0].where).toEqual({
      conversationId: 'c-1',
      state: 'COMPLETE',
    });
  });

  it('the post-check rejects a summary that leaks a name, including a clinician name', async () => {
    await jobs.summarise(job());
    const { postCheck } = ai.generateStructured.mock.calls[0][0];
    expect(postCheck(goodOutput)).toBe('ok');
    expect(postCheck({ ...goodOutput, overview: 'Isha Verma advised on sleep.' })).toEqual({
      reject: 'NAME_LEAK',
    });
  });

  it.each([
    ['a missing conversation', null],
    ['a conversation that is still open', conversation({ status: ConversationStatus.OPEN })],
    ['a purged conversation', conversation({ messagesPurgedAt: new Date() })],
    ['a READY summary', conversation({ summary: { status: SummaryStatus.READY } })],
    ['a PLACEHOLDER summary', conversation({ summary: { status: SummaryStatus.PLACEHOLDER } })],
  ])('does nothing for %s', async (_name, row) => {
    prisma.conversation.findUnique.mockResolvedValue(row);
    await jobs.summarise(job());
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(ai.generateStructured).not.toHaveBeenCalled();
    expect(prisma.conversationSummary.updateMany).not.toHaveBeenCalled();
  });

  it('retries a FAILED summary', async () => {
    prisma.conversation.findUnique.mockResolvedValue(
      conversation({ summary: { status: SummaryStatus.FAILED } }),
    );
    await jobs.summarise(job());
    expect(ai.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('creates the summary row when it is missing', async () => {
    prisma.conversation.findUnique.mockResolvedValue(conversation({ summary: null }));
    await jobs.summarise(job());
    expect(prisma.conversationSummary.createMany).toHaveBeenCalledWith({
      data: [{ conversationId: 'c-1', childId: 'child-1' }],
      skipDuplicates: true,
    });
  });

  it('stores a fixed READY summary for a conversation with no messages, without calling the model', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    await jobs.summarise(job());
    expect(ai.generateStructured).not.toHaveBeenCalled();
    expect(prisma.conversationSummary.updateMany.mock.calls[0][0].data).toMatchObject({
      status: SummaryStatus.READY,
      content: { overview: 'No messages were exchanged in this conversation.', themes: [] },
    });
  });

  it('records the failure code on the summary and rethrows, so the queue retries', async () => {
    const error = new AiRunError('AI_PROVIDER', { retryable: true });
    ai.generateStructured.mockRejectedValue(error);

    await expect(jobs.summarise(job())).rejects.toBe(error);

    const call = prisma.conversationSummary.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ status: SummaryStatus.FAILED, failureReason: 'AI_PROVIDER' });
  });

  it('rethrows an unexpected error without touching the summary', async () => {
    ai.generateStructured.mockRejectedValue(new Error('boom'));
    await expect(jobs.summarise(job())).rejects.toThrow('boom');
    expect(prisma.conversationSummary.updateMany).not.toHaveBeenCalled();
  });

  it.each([[{}], [null], [{ conversationId: 5 }], [[]]])(
    'rejects a malformed payload (%j)',
    async (payload) => {
      await expect(jobs.summarise(job(payload))).rejects.toThrow('no conversationId');
    },
  );
});

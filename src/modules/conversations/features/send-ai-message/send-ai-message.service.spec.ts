import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MessageState, Role, UserStatus } from '@prisma/client';
import { AiRunError, type AiChatEvent, type AiChatOutcome } from '@common/ai/ai.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { RETRACTED_REPLY } from '@modules/conversations/shared/ai-chat.constants';
import { SendAiMessageService, type ChatSink } from './send-ai-message.service';

const SECRET = 'SECRET-PROMPT-TEXT-4c1d';
const parent: AuthenticatedUser = {
  id: 'p1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const dto = { text: 'Hello', clientMessageId: 'm1' };

/** A scripted provider: these events, then (optionally) an error. */
function scripted(events: AiChatEvent[], fail?: Error, outcomes: AiChatOutcome[] = []) {
  return {
    events: (async function* () {
      for (const e of events) yield e;
      if (fail) throw fail;
    })(),
    finish: async (o: AiChatOutcome) => {
      outcomes.push(o);
    },
  };
}

function make(opts: { run?: ReturnType<typeof scripted> } = {}) {
  const config = {
    get: () => ({
      maxMessageChars: 1000,
      maxOutputTokens: 400,
      historyMessages: 10,
      offTopicLimit: 3,
      dailyMessages: 30,
      maxTurns: 40,
    }),
  };
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'conv-1',
        kind: 'AI',
        topic: 'TODAYS_ACTIVITIES',
        parentId: 'p1',
        childId: 'c1',
      }),
    },
    message: { findMany: jest.fn().mockResolvedValue([{ sender: 'PARENT', body: 'Hello' }]) },
  };
  const access = {
    assertCanChat: jest.fn().mockResolvedValue({ id: 'c1', name: 'Alex', parentId: 'p1' }),
  };
  const contexts = {
    build: jest.fn().mockResolvedValue({ context: { ageYears: 6 }, nameTokens: [] }),
  };
  const ai = { streamChat: jest.fn().mockReturnValue(opts.run ?? scripted([])) };
  const service = new SendAiMessageService(
    prisma as never,
    access as never,
    contexts as never,
    ai as never,
    config as never,
    { kick: jest.fn() } as never,
  );
  const stored = { id: 'reply-1', seq: 2, state: MessageState.COMPLETE };
  const internals = service as unknown as Record<string, jest.Mock>;
  jest
    .spyOn(service as never, 'persistParentMessage')
    .mockResolvedValue({ parent: { id: 'm', seq: 1 }, reply: null, closed: false } as never);
  jest.spyOn(service as never, 'nameGroups').mockResolvedValue([] as never);
  const storeReply = jest
    .spyOn(service as never, 'storeReply')
    .mockResolvedValue({ message: stored, closed: false } as never);
  return { service, prisma, access, contexts, ai, internals, storeReply };
}

function sink() {
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  let started = 0;
  const s: ChatSink = {
    start: () => {
      started += 1;
    },
    event: (name, data) => calls.push({ name, data }),
  };
  return { sink: s, calls, started: () => started };
}

describe('SendAiMessageService', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('refuses an over-long message before storing anything or calling the model', async () => {
    const h = make();
    const out = sink();

    const err = await h.service
      .stream(
        'conv-1',
        { ...dto, text: 'x'.repeat(1001) },
        parent,
        new AbortController().signal,
        out.sink,
      )
      .catch((e: unknown) => e);

    expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({
      code: 'MESSAGE_TOO_LONG',
    });
    expect(h.internals.persistParentMessage).not.toHaveBeenCalled();
    expect(h.ai.streamChat).not.toHaveBeenCalled();
    expect(out.started()).toBe(0);
  });

  it('refuses before storing anything when the caller may not chat (admin, AI off, wrong parent)', async () => {
    const h = make();
    h.access.assertCanChat.mockRejectedValue(new ServiceUnavailableException());

    await expect(
      h.service.stream('conv-1', dto, parent, new AbortController().signal, sink().sink),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(h.internals.persistParentMessage).not.toHaveBeenCalled();
    expect(h.ai.streamChat).not.toHaveBeenCalled();
  });

  it('a failure before the first text is an ordinary 503 and the headers are never sent', async () => {
    const outcomes: AiChatOutcome[] = [];
    const h = make({
      run: scripted([], new AiRunError('AI_PROVIDER', { httpStatus: 503 }), outcomes),
    });
    const out = sink();

    const err = await h.service
      .stream('conv-1', dto, parent, new AbortController().signal, out.sink)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
    expect(out.started()).toBe(0);
    expect(out.calls).toEqual([]);
    expect(h.storeReply).not.toHaveBeenCalled();
    expect(outcomes).toEqual(['INVALID_OUTPUT']);
  });

  it('an empty reply is a 503 too, not a stored answer', async () => {
    const h = make({ run: scripted([{ type: 'end', finishReason: 'stop' }]) });

    await expect(
      h.service.stream('conv-1', dto, parent, new AbortController().signal, sink().sink),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(h.storeReply).not.toHaveBeenCalled();
  });

  it('a failure after the first text is an error event with a code only, and nothing is stored', async () => {
    const h = make({
      run: scripted(
        [{ type: 'delta', text: 'Some words. ' }],
        new Error(`leaky provider error ${SECRET}`),
      ),
    });
    const out = sink();

    await expect(
      h.service.stream('conv-1', dto, parent, new AbortController().signal, out.sink),
    ).resolves.toBeUndefined();

    expect(out.started()).toBe(1);
    expect(out.calls[out.calls.length - 1]).toEqual({ name: 'error', data: { code: 'AI_FAILED' } });
    expect(h.storeReply).not.toHaveBeenCalled();
    // Only the error class is logged, never its message.
    expect(warn).toHaveBeenCalledWith(
      { errorClass: 'Error', code: undefined },
      'ai chat reply failed',
    );
    expect(JSON.stringify([out.calls, warn.mock.calls])).not.toContain(SECRET);
  });

  it('a provider error code after the first text is passed on as the code', async () => {
    const h = make({
      run: scripted([{ type: 'delta', text: 'Words. ' }], new AiRunError('AI_TIMEOUT')),
    });
    const out = sink();

    await h.service.stream('conv-1', dto, parent, new AbortController().signal, out.sink);

    expect(out.calls[out.calls.length - 1]).toEqual({
      name: 'error',
      data: { code: 'AI_TIMEOUT' },
    });
  });

  it('a chat closed while the reply streams ends with a CONVERSATION_CLOSED error event, not AI_FAILED', async () => {
    const h = make({
      run: scripted([
        { type: 'delta', text: 'A calm answer. ' },
        { type: 'end', finishReason: 'stop' },
      ]),
    });
    h.storeReply.mockRejectedValue(
      new ConflictException({ code: 'CONVERSATION_CLOSED', message: 'closed' }) as never,
    );
    const out = sink();

    await expect(
      h.service.stream('conv-1', dto, parent, new AbortController().signal, out.sink),
    ).resolves.toBeUndefined();

    expect(out.calls.map((c) => c.name)).toEqual(['delta', 'error']);
    expect(out.calls[1].data).toEqual({ code: 'CONVERSATION_CLOSED' });
  });

  it('retracts a bad sentence, stores the safe text and tells the run it was blocked', async () => {
    const outcomes: AiChatOutcome[] = [];
    const h = make({
      run: scripted(
        [
          { type: 'delta', text: 'A calm start. ' },
          { type: 'delta', text: 'Give a dose of melatonin. ' },
          { type: 'delta', text: 'More.' },
          { type: 'end', finishReason: 'stop' },
        ],
        undefined,
        outcomes,
      ),
    });
    const out = sink();

    await h.service.stream('conv-1', dto, parent, new AbortController().signal, out.sink);

    expect(out.calls.map((c) => c.name)).toEqual(['delta', 'retract', 'done']);
    expect(out.calls[1].data).toEqual({ text: RETRACTED_REPLY });
    expect(h.storeReply).toHaveBeenCalledWith(
      'conv-1',
      { state: MessageState.RETRACTED, body: RETRACTED_REPLY },
      3,
    );
    expect(outcomes).toEqual(['BLOCKED']);
  });

  it('stores nothing and reports no verdict of success when the client has left', async () => {
    const controller = new AbortController();
    const h = make({
      run: scripted([{ type: 'delta', text: 'Partial answer. ' }]), // ends without an `end` event
    });
    controller.abort();

    await h.service.stream('conv-1', dto, parent, controller.signal, sink().sink);

    expect(h.storeReply).not.toHaveBeenCalled();
  });

  it('refuses a second send while a reply is being written, then frees the chat', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = {
      events: (async function* () {
        yield { type: 'delta', text: 'Working on it. ' } as AiChatEvent;
        await gate;
        yield { type: 'end', finishReason: 'stop' } as AiChatEvent;
      })(),
      finish: async () => undefined,
    };
    const h = make({ run: slow as never });

    const first = h.service.stream(
      'conv-1',
      dto,
      parent,
      new AbortController().signal,
      sink().sink,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const err = await h.service
      .stream(
        'conv-1',
        { ...dto, clientMessageId: 'm2' },
        parent,
        new AbortController().signal,
        sink().sink,
      )
      .catch((e: unknown) => e);

    expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({
      code: 'AI_CHAT_BUSY',
    });
    release();
    await first;
    h.ai.streamChat.mockReturnValue(
      scripted([
        { type: 'delta', text: 'Ok. ' },
        { type: 'end', finishReason: 'stop' },
      ]),
    );
    await expect(
      h.service.stream(
        'conv-1',
        { ...dto, clientMessageId: 'm3' },
        parent,
        new AbortController().signal,
        sink().sink,
      ),
    ).resolves.toBeUndefined();
  });
});

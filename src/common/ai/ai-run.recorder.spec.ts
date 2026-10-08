import { Logger } from '@nestjs/common';
import { AiRunStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { AiRunRecorder } from './ai-run.recorder';
import { AiRunError } from './ai.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const base = {
  capability: 'coaching-tip',
  promptId: 'coaching-tip',
  promptVersion: 1,
  provider: 'google',
  model: 'gemini-3.5-flash-lite',
  attempt: 1,
  latencyMs: 1200,
  userId: 'u1',
  childId: 'c1',
};

describe('AiRunRecorder', () => {
  let create: jest.Mock;
  let recorder: AiRunRecorder;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    recorder = new AiRunRecorder({ aiRun: { create } } as never);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes the row with a paid-equivalent cost estimate', async () => {
    await recorder.record({
      ...base,
      status: AiRunStatus.SUCCEEDED,
      inputTokens: 1500,
      outputTokens: 300,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: AiRunStatus.SUCCEEDED,
        inputTokens: 1500,
        outputTokens: 300,
        costEstimateMicroUsd: 1200,
        userId: 'u1',
        childId: 'c1',
      }),
    });
  });

  it('logs exactly the whitelisted keys, at log level on success and warn otherwise', async () => {
    await recorder.record({
      ...base,
      status: AiRunStatus.SUCCEEDED,
      inputTokens: 1,
      outputTokens: 2,
    });
    await recorder.record({
      ...base,
      status: AiRunStatus.RATE_LIMITED,
      httpStatus: 429,
      errorClass: 'APICallError',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const keys = Object.keys(log.mock.calls[0][0] as object).sort();
    expect(keys).toEqual(
      [
        'attempt',
        'capability',
        'errorClass',
        'httpStatus',
        'inputTokens',
        'latencyMs',
        'model',
        'outputTokens',
        'promptId',
        'promptVersion',
        'provider',
        'status',
        'warnings',
      ].sort(),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('u1');
  });

  it('never throws when the insert fails and logs only the error class', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('db said PROMPT-SECRET'), { name: 'PrismaClientKnownRequestError' }),
    );

    await expect(
      recorder.record({ ...base, status: AiRunStatus.SUCCEEDED }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      { errorClass: 'PrismaClientKnownRequestError' },
      'ai run not recorded',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('PROMPT-SECRET');
  });

  describe('captureIfUnexpected (plan 0018 Q7.4)', () => {
    it.each([400, 401, 403, 404])('captures provider HTTP %i', (httpStatus) => {
      const err = new AiRunError('AI_PROVIDER', { httpStatus, provider: 'google', model: 'm' });
      recorder.captureIfUnexpected(err);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.anything());
    });

    it('captures an exhausted invalid-output failure', () => {
      recorder.captureIfUnexpected(new AiRunError('AI_INVALID_OUTPUT'));
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it.each([
      new AiRunError('AI_RATE_LIMITED', { httpStatus: 429 }),
      new AiRunError('AI_PROVIDER', { httpStatus: 503 }),
      new AiRunError('AI_TIMEOUT'),
      new AiRunError('AI_BUDGET'),
      new AiRunError('AI_BLOCKED'),
      new AiRunError('AI_DISABLED'),
    ])('does not capture operational noise: $code', (err) => {
      recorder.captureIfUnexpected(err);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });
});

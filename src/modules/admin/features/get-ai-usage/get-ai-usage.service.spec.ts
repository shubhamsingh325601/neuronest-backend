import { Test } from '@nestjs/testing';
import { AiRunStatus } from '@prisma/client';
import { AiBudgetService } from '@common/ai/ai-budget.service';
import { pacificDayStart } from '@common/ai/pacific-day.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetAiUsageService } from './get-ai-usage.service';

describe('GetAiUsageService', () => {
  const prisma = { aiRun: { groupBy: jest.fn(), aggregate: jest.fn() } };
  const budget = { usedToday: jest.fn(), dailyBudget: 400 };
  let service: GetAiUsageService;

  // 2026-10-07 12:00 UTC is 05:00 Pacific, the same Pacific day.
  const now = new Date('2026-10-07T12:00:00Z');

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetAiUsageService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiBudgetService, useValue: budget },
      ],
    }).compile();
    service = moduleRef.get(GetAiUsageService);
  });

  it('shapes the aggregates, zero-fills every status, and scopes to the Pacific day', async () => {
    budget.usedToday.mockResolvedValue(5);
    prisma.aiRun.groupBy
      .mockResolvedValueOnce([
        { status: AiRunStatus.SUCCEEDED, _count: { _all: 4 } },
        { status: AiRunStatus.RATE_LIMITED, _count: { _all: 1 } },
        { status: AiRunStatus.REJECTED_BUDGET, _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        {
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
          _count: { _all: 1 },
          _sum: { inputTokens: null, outputTokens: null },
        },
        {
          provider: 'google',
          model: 'gemini-3.5-flash-lite',
          _count: { _all: 4 },
          _sum: { inputTokens: 400, outputTokens: 250 },
        },
      ])
      .mockResolvedValueOnce([{ errorClass: 'APICallError', _count: { _all: 1 } }]);
    prisma.aiRun.aggregate.mockResolvedValue({
      _sum: { inputTokens: 400, outputTokens: 250, costEstimateMicroUsd: 745 },
    });

    const result = await service.get(now);

    expect(result).toEqual({
      date: '2026-10-07',
      requestsUsed: 5,
      requestBudget: 400,
      requestsByStatus: {
        SUCCEEDED: 4,
        INVALID_OUTPUT: 0,
        BLOCKED: 0,
        RATE_LIMITED: 1,
        TIMEOUT: 0,
        PROVIDER_ERROR: 0,
        REJECTED_BUDGET: 2,
      },
      tokens: { input: 400, output: 250 },
      costEstimateMicroUsd: 745,
      byModel: [
        {
          provider: 'google',
          model: 'gemini-3.5-flash-lite',
          requests: 4,
          inputTokens: 400,
          outputTokens: 250,
        },
        {
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
      errorsByClass: [{ errorClass: 'APICallError', count: 1 }],
    });

    const since = { gte: pacificDayStart(now) };
    expect(budget.usedToday).toHaveBeenCalledWith(now);
    expect(prisma.aiRun.groupBy.mock.calls[0][0].where).toEqual({ createdAt: since });
    // The per-model breakdown counts provider attempts only, matching the budget.
    expect(prisma.aiRun.groupBy.mock.calls[1][0].where).toEqual({
      createdAt: since,
      status: { not: AiRunStatus.REJECTED_BUDGET },
    });
  });

  it('returns zeros and empty lists when nothing ran today', async () => {
    budget.usedToday.mockResolvedValue(0);
    prisma.aiRun.groupBy.mockResolvedValue([]);
    prisma.aiRun.aggregate.mockResolvedValue({
      _sum: { inputTokens: null, outputTokens: null, costEstimateMicroUsd: null },
    });

    const result = await service.get(now);

    expect(result.requestsUsed).toBe(0);
    expect(result.tokens).toEqual({ input: 0, output: 0 });
    expect(result.costEstimateMicroUsd).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.errorsByClass).toEqual([]);
    expect(Object.values(result.requestsByStatus).every((n) => n === 0)).toBe(true);
  });
});

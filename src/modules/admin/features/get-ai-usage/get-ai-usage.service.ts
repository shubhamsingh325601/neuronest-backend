import { Injectable } from '@nestjs/common';
import { AiRunStatus } from '@prisma/client';
import { AiBudgetService } from '@common/ai/ai-budget.service';
import { pacificDateString, pacificDayStart } from '@common/ai/pacific-day.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiUsageResponseDto } from './dto/ai-usage.response.dto';

/**
 * Plan 0018 §6 — one fixed shape for the current Pacific day, read from `ai_runs` metadata only
 * (never a prompt or output). Three small aggregates over the `createdAt` index; no generic analytics.
 */
@Injectable()
export class GetAiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
  ) {}

  async get(now: Date = new Date()): Promise<AiUsageResponseDto> {
    const where = { createdAt: { gte: pacificDayStart(now) } };
    const spent = { ...where, status: { not: AiRunStatus.REJECTED_BUDGET } };

    const [requestsUsed, byStatus, byModelRows, totals, byErrorClass] = await Promise.all([
      this.budget.usedToday(now),
      this.prisma.aiRun.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.aiRun.groupBy({
        by: ['provider', 'model'],
        where: spent,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiRun.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true, costEstimateMicroUsd: true },
      }),
      this.prisma.aiRun.groupBy({
        by: ['errorClass'],
        where: { ...where, errorClass: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const requestsByStatus = Object.fromEntries(
      Object.values(AiRunStatus).map((status) => [status, 0]),
    ) as Record<string, number>;
    for (const row of byStatus) requestsByStatus[row.status] = row._count._all;

    return {
      date: pacificDateString(now),
      requestsUsed,
      requestBudget: this.budget.dailyBudget,
      requestsByStatus,
      tokens: {
        input: totals._sum.inputTokens ?? 0,
        output: totals._sum.outputTokens ?? 0,
      },
      costEstimateMicroUsd: totals._sum.costEstimateMicroUsd ?? 0,
      byModel: byModelRows
        .map((row) => ({
          provider: row.provider,
          model: row.model,
          requests: row._count._all,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
        }))
        .sort((a, b) => b.requests - a.requests),
      errorsByClass: byErrorClass
        .map((row) => ({ errorClass: row.errorClass as string, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

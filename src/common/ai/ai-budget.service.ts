import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRunStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { PrismaService } from '@common/prisma/prisma.service';
import { pacificDayStart } from './pacific-day.util';

/**
 * Project-wide provider-request budget for the current Pacific day (plan 0018 Q8.4). It is
 * `COUNT(*)` over `ai_runs`, one row per provider attempt, excluding attempts we refused
 * ourselves. A soft limit: concurrent requests can overshoot by a request; the provider's own
 * 429 is the hard stop.
 */
@Injectable()
export class AiBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get dailyBudget(): number {
    return this.config.get('ai', { infer: true }).dailyRequestBudget;
  }

  async usedToday(now: Date = new Date()): Promise<number> {
    return this.prisma.aiRun.count({
      where: {
        createdAt: { gte: pacificDayStart(now) },
        status: { not: AiRunStatus.REJECTED_BUDGET },
      },
    });
  }

  /**
   * Generations this user started today (Pacific day): one first-attempt run per generation, so a
   * fallback attempt or a refused-by-budget run does not count against their personal limit.
   */
  async generationsByUserToday(userId: string, now: Date = new Date()): Promise<number> {
    return this.prisma.aiRun.count({
      where: {
        userId,
        attempt: 1,
        createdAt: { gte: pacificDayStart(now) },
        status: { not: AiRunStatus.REJECTED_BUDGET },
      },
    });
  }

  async hasCapacity(now: Date = new Date()): Promise<boolean> {
    return (await this.usedToday(now)) < this.dailyBudget;
  }
}

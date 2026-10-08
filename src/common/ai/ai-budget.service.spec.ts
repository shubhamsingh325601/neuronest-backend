import { AiRunStatus } from '@prisma/client';
import { AiBudgetService } from './ai-budget.service';

function make(count: number, budget = 400) {
  const prisma = { aiRun: { count: jest.fn().mockResolvedValue(count) } };
  const config = { get: () => ({ dailyRequestBudget: budget }) };
  return { service: new AiBudgetService(prisma as never, config as never), prisma };
}

describe('AiBudgetService', () => {
  it('counts non-rejected runs since Pacific midnight', async () => {
    const { service, prisma } = make(7);

    const used = await service.usedToday(new Date('2026-07-15T20:30:00Z'));

    expect(used).toBe(7);
    expect(prisma.aiRun.count).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date('2026-07-15T07:00:00.000Z') },
        status: { not: AiRunStatus.REJECTED_BUDGET },
      },
    });
  });

  it('has capacity while used < budget and not at the budget', async () => {
    expect(await make(399).service.hasCapacity()).toBe(true);
    expect(await make(400).service.hasCapacity()).toBe(false);
    expect(await make(401).service.hasCapacity()).toBe(false);
  });

  it("counts a user's first-attempt runs since Pacific midnight", async () => {
    const { service, prisma } = make(2);

    const used = await service.generationsByUserToday('u1', new Date('2026-07-15T20:30:00Z'));

    expect(used).toBe(2);
    expect(prisma.aiRun.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        attempt: 1,
        createdAt: { gte: new Date('2026-07-15T07:00:00.000Z') },
        status: { not: AiRunStatus.REJECTED_BUDGET },
      },
    });
  });

  it('exposes the configured budget', () => {
    expect(make(0, 15).service.dailyBudget).toBe(15);
  });
});

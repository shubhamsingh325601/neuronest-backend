import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { TodayFocusService } from './today-focus.service';

describe('TodayFocusService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    plan: { findFirst: jest.fn() },
  };
  let service: TodayFocusService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const child = { id: 'child-1', parentId: 'parent-1' };

  const planWithDay = (dayNumber: number, startOffsetDays: number) => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - startOffsetDays);
    return {
      id: 'plan-1',
      childId: 'child-1',
      planTemplateId: 'template-1',
      status: 'ACTIVE',
      origin: 'MANUAL',
      startDate: start,
      createdById: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      planTemplate: {
        days: [{ id: 'day-1', planTemplateId: 'template-1', dayNumber, title: 'Day', instructions: 'x' }],
      },
    };
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue(child);
    const moduleRef = await Test.createTestingModule({
      providers: [TodayFocusService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TodayFocusService);
  });

  it('404s a missing child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.get('child-1', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('forbids a different parent', async () => {
    await expect(service.get('child-1', asUser('parent-2', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s when the child has no active plan', async () => {
    prisma.plan.findFirst.mockResolvedValue(null);
    await expect(service.get('child-1', asUser('parent-1', Role.PARENT))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns day: null when today falls outside the template's range", async () => {
    prisma.plan.findFirst.mockResolvedValue(planWithDay(5, 0));
    const result = await service.get('child-1', asUser('parent-1', Role.PARENT));
    expect(result.day).toBeNull();
  });

  it('returns the matching day when in range', async () => {
    prisma.plan.findFirst.mockResolvedValue(planWithDay(3, 2));
    const result = await service.get('child-1', asUser('parent-1', Role.PARENT));
    expect(result.day?.dayNumber).toBe(3);
  });
});

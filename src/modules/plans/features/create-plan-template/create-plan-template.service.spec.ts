import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreatePlanTemplateService } from './create-plan-template.service';

describe('CreatePlanTemplateService', () => {
  const tx = {
    planTemplate: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
    planTemplateSection: { create: jest.fn() },
    planTemplateDay: { createMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  let service: CreatePlanTemplateService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    const moduleRef = await Test.createTestingModule({
      providers: [CreatePlanTemplateService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CreatePlanTemplateService);
  });

  it('rejects a non-contiguous days[] set', async () => {
    await expect(
      service.create('admin-1', {
        title: 'Week 1',
        days: [
          { dayNumber: 1, title: 'Day 1', instructions: 'Do a thing' },
          { dayNumber: 3, title: 'Day 3', instructions: 'Do another thing' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a sectionPosition with no matching section', async () => {
    await expect(
      service.create('admin-1', {
        title: 'Week 1',
        days: [{ dayNumber: 1, title: 'Day 1', instructions: 'A', sectionPosition: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates the template, its sections and days (linked by position)', async () => {
    tx.planTemplate.create.mockResolvedValue({ id: 'template-1' });
    tx.planTemplateSection.create.mockResolvedValue({ id: 'section-1' });
    tx.planTemplate.findUniqueOrThrow.mockResolvedValue({
      id: 'template-1',
      title: 'Week 1',
      description: null,
      status: 'DRAFT',
      createdById: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      days: [
        { id: 'd2', dayNumber: 2, title: 'Day 2', instructions: 'B', sectionId: null },
        { id: 'd1', dayNumber: 1, title: 'Day 1', instructions: 'A', sectionId: 'section-1' },
      ],
      sections: [{ id: 'section-1', title: 'Morning', position: 1 }],
    });

    const result = await service.create('admin-1', {
      title: 'Week 1',
      sections: [{ title: 'Morning' }],
      days: [
        { dayNumber: 2, title: 'Day 2', instructions: 'B' },
        { dayNumber: 1, title: 'Day 1', instructions: 'A', sectionPosition: 1 },
      ],
    });

    expect(result.days.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(result.sections).toHaveLength(1);
    expect(tx.planTemplateDay.createMany).toHaveBeenCalledWith({
      data: [
        {
          planTemplateId: 'template-1',
          sectionId: undefined,
          dayNumber: 2,
          title: 'Day 2',
          instructions: 'B',
        },
        {
          planTemplateId: 'template-1',
          sectionId: 'section-1',
          dayNumber: 1,
          title: 'Day 1',
          instructions: 'A',
        },
      ],
    });
  });
});

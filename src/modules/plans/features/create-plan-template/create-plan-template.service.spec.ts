import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreatePlanTemplateService } from './create-plan-template.service';

describe('CreatePlanTemplateService', () => {
  const prisma = { planTemplate: { create: jest.fn() } };
  let service: CreatePlanTemplateService;

  beforeEach(async () => {
    jest.resetAllMocks();
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
    expect(prisma.planTemplate.create).not.toHaveBeenCalled();
  });

  it('accepts an out-of-order but contiguous days[] set and creates nested', async () => {
    prisma.planTemplate.create.mockResolvedValue({
      id: 'template-1',
      title: 'Week 1',
      description: null,
      status: 'DRAFT',
      createdById: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      days: [
        { id: 'day-1', planTemplateId: 'template-1', dayNumber: 1, title: 'Day 1', instructions: 'A' },
        { id: 'day-2', planTemplateId: 'template-1', dayNumber: 2, title: 'Day 2', instructions: 'B' },
      ],
    });

    const result = await service.create('admin-1', {
      title: 'Week 1',
      days: [
        { dayNumber: 2, title: 'Day 2', instructions: 'B' },
        { dayNumber: 1, title: 'Day 1', instructions: 'A' },
      ],
    });

    expect(result.days).toHaveLength(2);
    expect(prisma.planTemplate.create).toHaveBeenCalledWith({
      data: {
        title: 'Week 1',
        description: undefined,
        createdById: 'admin-1',
        days: {
          create: [
            { dayNumber: 2, title: 'Day 2', instructions: 'B' },
            { dayNumber: 1, title: 'Day 1', instructions: 'A' },
          ],
        },
      },
      include: { days: true },
    });
  });
});

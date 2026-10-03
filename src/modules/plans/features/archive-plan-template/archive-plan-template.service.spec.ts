import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlanTemplateStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ArchivePlanTemplateService } from './archive-plan-template.service';

describe('ArchivePlanTemplateService', () => {
  const prisma = { planTemplate: { findUnique: jest.fn(), update: jest.fn() } };
  let service: ArchivePlanTemplateService;

  const template = {
    id: 't1',
    title: 'Week 1',
    description: null,
    status: PlanTemplateStatus.DRAFT,
    createdById: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [],
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ArchivePlanTemplateService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ArchivePlanTemplateService);
  });

  it('404s when the template does not exist', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(null);
    await expect(service.archive('missing')).rejects.toThrow(NotFoundException);
  });

  it('archives a DRAFT template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(template);
    prisma.planTemplate.update.mockResolvedValue({
      ...template,
      status: PlanTemplateStatus.ARCHIVED,
    });

    const result = await service.archive('t1');

    expect(prisma.planTemplate.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: PlanTemplateStatus.ARCHIVED },
      include: { days: true },
    });
    expect(result.status).toBe(PlanTemplateStatus.ARCHIVED);
  });

  it('archives a PUBLISHED template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue({
      ...template,
      status: PlanTemplateStatus.PUBLISHED,
    });
    prisma.planTemplate.update.mockResolvedValue({
      ...template,
      status: PlanTemplateStatus.ARCHIVED,
    });

    await service.archive('t1');
    expect(prisma.planTemplate.update).toHaveBeenCalled();
  });

  it('is idempotent when already ARCHIVED', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue({
      ...template,
      status: PlanTemplateStatus.ARCHIVED,
    });

    const result = await service.archive('t1');

    expect(result.status).toBe(PlanTemplateStatus.ARCHIVED);
    expect(prisma.planTemplate.update).not.toHaveBeenCalled();
  });
});

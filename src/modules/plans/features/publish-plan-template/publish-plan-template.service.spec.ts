import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { PublishPlanTemplateService } from './publish-plan-template.service';

describe('PublishPlanTemplateService', () => {
  const prisma = { planTemplate: { findUnique: jest.fn(), update: jest.fn() } };
  let service: PublishPlanTemplateService;

  const template = {
    id: 'template-1',
    title: 'Week 1',
    description: null,
    status: 'DRAFT',
    createdById: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [],
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PublishPlanTemplateService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PublishPlanTemplateService);
  });

  it('404s a missing template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(null);
    await expect(service.publish('missing')).rejects.toThrow(NotFoundException);
  });

  it('publishes a DRAFT template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(template);
    prisma.planTemplate.update.mockResolvedValue({ ...template, status: 'PUBLISHED' });
    const result = await service.publish('template-1');
    expect(result.status).toBe('PUBLISHED');
    expect(prisma.planTemplate.update).toHaveBeenCalled();
  });

  it('is idempotent when already PUBLISHED (no update call)', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue({ ...template, status: 'PUBLISHED' });
    const result = await service.publish('template-1');
    expect(result.status).toBe('PUBLISHED');
    expect(prisma.planTemplate.update).not.toHaveBeenCalled();
  });
});

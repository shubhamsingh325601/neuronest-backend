import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { GetPlanTemplateService } from './get-plan-template.service';

describe('GetPlanTemplateService', () => {
  const prisma = { planTemplate: { findUnique: jest.fn() } };
  let service: GetPlanTemplateService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const draftTemplate = {
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
      providers: [GetPlanTemplateService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetPlanTemplateService);
  });

  it('404s a missing template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(null);
    await expect(service.getById('missing', asUser('admin-1', Role.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s a DRAFT template for a clinician (not 403)', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(draftTemplate);
    await expect(
      service.getById('template-1', asUser('clinician-1', Role.CLINICIAN)),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows admin to read a DRAFT template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue(draftTemplate);
    const result = await service.getById('template-1', asUser('admin-1', Role.ADMIN));
    expect(result.id).toBe('template-1');
  });

  it('allows a clinician to read a PUBLISHED template', async () => {
    prisma.planTemplate.findUnique.mockResolvedValue({ ...draftTemplate, status: 'PUBLISHED' });
    const result = await service.getById('template-1', asUser('clinician-1', Role.CLINICIAN));
    expect(result.status).toBe('PUBLISHED');
  });
});

import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListPlanTemplatesService } from './list-plan-templates.service';

describe('ListPlanTemplatesService', () => {
  const prisma = { planTemplate: { findMany: jest.fn() } };
  let service: ListPlanTemplatesService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.planTemplate.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListPlanTemplatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListPlanTemplatesService);
  });

  it('filters to PUBLISHED for a clinician', async () => {
    await service.list(asUser('clinician-1', Role.CLINICIAN), {});
    expect(prisma.planTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PUBLISHED' } }),
    );
  });

  it('applies no status filter for admin', async () => {
    await service.list(asUser('admin-1', Role.ADMIN), {});
    expect(prisma.planTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

import { Test } from '@nestjs/testing';
import { ClinicianApplicationStatus, PlanStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetSummaryService } from './get-summary.service';

describe('GetSummaryService', () => {
  const prisma = {
    clinicianApplication: { count: jest.fn() },
    user: { count: jest.fn() },
    plan: { count: jest.fn() },
    child: { count: jest.fn() },
  };
  let service: GetSummaryService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetSummaryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetSummaryService);
  });

  it('runs one independent COUNT per field, with the right filters', async () => {
    prisma.clinicianApplication.count.mockResolvedValue(3);
    prisma.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(7);
    prisma.plan.count.mockResolvedValue(4);
    prisma.child.count.mockResolvedValueOnce(6).mockResolvedValueOnce(2);

    const result = await service.get();

    expect(prisma.clinicianApplication.count).toHaveBeenCalledWith({
      where: { status: ClinicianApplicationStatus.PENDING },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
      where: { role: Role.CLINICIAN, status: UserStatus.ACTIVE },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: { role: Role.PARENT, status: UserStatus.ACTIVE },
    });
    expect(prisma.plan.count).toHaveBeenCalledWith({ where: { status: PlanStatus.ACTIVE } });
    expect(prisma.child.count).toHaveBeenNthCalledWith(1, {
      where: { clinicianAssignments: { some: {} } },
    });
    expect(prisma.child.count).toHaveBeenNthCalledWith(2, {
      where: { clinicianAssignments: { none: {} } },
    });

    expect(result).toEqual({
      pendingClinicianApplications: 3,
      activeClinicians: 5,
      activeParents: 7,
      activePlans: 4,
      childrenWithAssignedClinician: 6,
      childrenWithoutClinician: 2,
    });
  });

  it('returns all zeros against an empty database', async () => {
    prisma.clinicianApplication.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.plan.count.mockResolvedValue(0);
    prisma.child.count.mockResolvedValue(0);

    const result = await service.get();

    expect(result).toEqual({
      pendingClinicianApplications: 0,
      activeClinicians: 0,
      activeParents: 0,
      activePlans: 0,
      childrenWithAssignedClinician: 0,
      childrenWithoutClinician: 0,
    });
  });
});

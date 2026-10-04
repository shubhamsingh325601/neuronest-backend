import { Test } from '@nestjs/testing';
import { JobStatus, PlanStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetSummaryService } from './get-summary.service';

describe('GetSummaryService', () => {
  const prisma = {
    user: { count: jest.fn() },
    plan: { count: jest.fn() },
    child: { count: jest.fn() },
    job: { count: jest.fn() },
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
    prisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(5).mockResolvedValueOnce(7);
    prisma.plan.count.mockResolvedValue(4);
    prisma.child.count.mockResolvedValueOnce(6).mockResolvedValueOnce(2);
    prisma.job.count.mockResolvedValue(9);

    const result = await service.get();

    expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
      where: { role: Role.CLINICIAN, status: UserStatus.INVITED },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: { role: Role.CLINICIAN, status: UserStatus.ACTIVE },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(3, {
      where: { role: Role.PARENT, status: UserStatus.ACTIVE },
    });
    expect(prisma.plan.count).toHaveBeenCalledWith({ where: { status: PlanStatus.ACTIVE } });
    expect(prisma.child.count).toHaveBeenNthCalledWith(1, {
      where: { clinicianAssignments: { some: {} } },
    });
    expect(prisma.child.count).toHaveBeenNthCalledWith(2, {
      where: { clinicianAssignments: { none: {} } },
    });

    expect(prisma.job.count).toHaveBeenCalledWith({ where: { status: JobStatus.DEAD } });

    expect(result).toEqual({
      invitedClinicians: 3,
      activeClinicians: 5,
      activeParents: 7,
      activePlans: 4,
      childrenWithAssignedClinician: 6,
      childrenWithoutClinician: 2,
      deadJobs: 9,
    });
    expect(result).not.toHaveProperty('pendingClinicianApplications');
  });

  it('returns all zeros against an empty database', async () => {
    prisma.user.count.mockResolvedValue(0);
    prisma.plan.count.mockResolvedValue(0);
    prisma.child.count.mockResolvedValue(0);
    prisma.job.count.mockResolvedValue(0);

    const result = await service.get();

    expect(result).toEqual({
      invitedClinicians: 0,
      activeClinicians: 0,
      activeParents: 0,
      activePlans: 0,
      childrenWithAssignedClinician: 0,
      childrenWithoutClinician: 0,
      deadJobs: 0,
    });
  });
});

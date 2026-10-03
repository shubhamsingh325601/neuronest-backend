import { Injectable } from '@nestjs/common';
import { ClinicianApplicationStatus, PlanStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { AdminSummaryResponseDto } from './dto/admin-summary.response.dto';

/**
 * D1 (plan 0008) — fixed flat shape, six independent `COUNT` queries against
 * already-indexed columns. No materialized view, no new index, no generic analytics
 * surface (§3 row 12) — revisit only if a specific query is measured slow at real
 * data volume.
 */
@Injectable()
export class GetSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AdminSummaryResponseDto> {
    const [
      pendingClinicianApplications,
      activeClinicians,
      activeParents,
      activePlans,
      childrenWithAssignedClinician,
      childrenWithoutClinician,
    ] = await Promise.all([
      this.prisma.clinicianApplication.count({
        where: { status: ClinicianApplicationStatus.PENDING },
      }),
      this.prisma.user.count({ where: { role: Role.CLINICIAN, status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { role: Role.PARENT, status: UserStatus.ACTIVE } }),
      this.prisma.plan.count({ where: { status: PlanStatus.ACTIVE } }),
      this.prisma.child.count({ where: { clinicianAssignments: { some: {} } } }),
      this.prisma.child.count({ where: { clinicianAssignments: { none: {} } } }),
    ]);

    return {
      pendingClinicianApplications,
      activeClinicians,
      activeParents,
      activePlans,
      childrenWithAssignedClinician,
      childrenWithoutClinician,
    };
  }
}

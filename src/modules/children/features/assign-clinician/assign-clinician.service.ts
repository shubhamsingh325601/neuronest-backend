import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianChildAssignmentDto } from '@modules/children/shared/clinician-child-assignment.dto';
import { AssignClinicianDto } from './dto/assign-clinician.dto';

/** Admin assigns a clinician to a child, creating the join row that scopes every later clinician-side ownership check. */
@Injectable()
export class AssignClinicianService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(
    childId: string,
    adminId: string,
    dto: AssignClinicianDto,
  ): Promise<ClinicianChildAssignmentDto> {
    const child = await this.prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    const clinician = await this.prisma.user.findUnique({
      where: { id: dto.clinicianId },
      select: { id: true, role: true },
    });
    if (!clinician || clinician.role !== Role.CLINICIAN) {
      throw new NotFoundException({
        code: 'CLINICIAN_NOT_FOUND',
        message: 'No clinician with that id.',
      });
    }

    const existing = await this.prisma.clinicianChildAssignment.findUnique({
      where: { clinicianId_childId: { clinicianId: clinician.id, childId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CLINICIAN_ALREADY_ASSIGNED',
        message: 'This clinician is already assigned to this child.',
      });
    }

    const assignment = await this.prisma.clinicianChildAssignment.create({
      data: { clinicianId: clinician.id, childId, assignedByAdminId: adminId },
    });
    return ClinicianChildAssignmentDto.from(assignment);
  }
}

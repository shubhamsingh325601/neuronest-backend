import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClinicianChildAssignment, Role } from '@prisma/client';

/** Full representation of a clinician↔child assignment, as returned to admin. */
export class ClinicianChildAssignmentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clinicianId!: string;

  @ApiProperty()
  childId!: string;

  @ApiPropertyOptional({ description: 'Omitted for the PARENT audience.' })
  assignedByAdminId?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(
    row: ClinicianChildAssignment,
    { audience }: { audience?: Role } = {},
  ): ClinicianChildAssignmentDto {
    const dto: ClinicianChildAssignmentDto = {
      id: row.id,
      clinicianId: row.clinicianId,
      childId: row.childId,
      assignedByAdminId: row.assignedByAdminId,
      createdAt: row.createdAt,
    };
    // Which admin made the assignment is internal; the care-team view for parents omits it.
    if (audience === Role.PARENT) {
      delete dto.assignedByAdminId;
    }
    return dto;
  }
}

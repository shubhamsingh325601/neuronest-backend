import { ApiProperty } from '@nestjs/swagger';
import { ClinicianChildAssignment } from '@prisma/client';

/** Full representation of a clinician↔child assignment, as returned to admin. */
export class ClinicianChildAssignmentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clinicianId!: string;

  @ApiProperty()
  childId!: string;

  @ApiProperty()
  assignedByAdminId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: ClinicianChildAssignment): ClinicianChildAssignmentDto {
    return {
      id: row.id,
      clinicianId: row.clinicianId,
      childId: row.childId,
      assignedByAdminId: row.assignedByAdminId,
      createdAt: row.createdAt,
    };
  }
}

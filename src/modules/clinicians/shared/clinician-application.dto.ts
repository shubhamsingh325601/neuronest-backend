import { ApiProperty } from '@nestjs/swagger';
import { ClinicianApplication, ClinicianApplicationStatus } from '@prisma/client';

/** Full representation of a clinician application lead, as returned to an admin. */
export class ClinicianApplicationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Dr. Sam Okafor' })
  name!: string;

  @ApiProperty({ example: 'sam.okafor@clinic.example' })
  email!: string;

  @ApiProperty({ example: 'Paediatric OT, 8 years with ASD/ADHD caseloads.' })
  context!: string;

  @ApiProperty({ enum: ClinicianApplicationStatus, example: ClinicianApplicationStatus.PENDING })
  status!: ClinicianApplicationStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Reason captured on reject.' })
  reviewNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: ClinicianApplication): ClinicianApplicationDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      context: row.context,
      status: row.status,
      reviewNote: row.reviewNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

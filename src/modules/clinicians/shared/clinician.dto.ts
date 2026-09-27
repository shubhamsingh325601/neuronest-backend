import { ApiProperty } from '@nestjs/swagger';
import { User, UserStatus } from '@prisma/client';

/** Summary of a provisioned CLINICIAN user, as returned to admin for the assign-clinician picker. */
export class ClinicianDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Dr. Sam Okafor' })
  name!: string;

  @ApiProperty({ example: 'sam.okafor@clinic.example' })
  email!: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: User): ClinicianDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}

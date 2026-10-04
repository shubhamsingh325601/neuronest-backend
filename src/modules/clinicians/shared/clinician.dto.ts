import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import type { ClinicianRow } from './clinician.include';

/** Summary of a CLINICIAN user, as returned to admin (directory + assign-clinician picker). */
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

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the latest invitation was issued; null for clinicians never invited.',
  })
  invitationSentAt!: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the latest invitation link expires.',
  })
  invitationExpiresAt!: Date | null;

  static from(row: ClinicianRow): ClinicianDto {
    const invitation = row.verificationTokens[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
      invitationSentAt: invitation?.createdAt ?? null,
      invitationExpiresAt: invitation?.expiresAt ?? null,
    };
  }
}

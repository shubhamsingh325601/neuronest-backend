import { ApiProperty } from '@nestjs/swagger';
import { ClinicianDto } from './clinician.dto';
import type { ClinicianDetailRow } from './clinician.include';
import { ClinicianProfileDto } from './clinician-profile.dto';

/** Full admin view of one clinician: summary + profile + lifecycle timestamps + caseload. */
export class ClinicianDetailDto extends ClinicianDto {
  @ApiProperty({ type: ClinicianProfileDto })
  profile!: ClinicianProfileDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the clinician completed setup (= email verified); null while invited.',
  })
  activatedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: [String], description: 'Ids of the children this clinician is assigned to.' })
  assignedChildIds!: string[];

  static fromDetail(row: ClinicianDetailRow): ClinicianDetailDto {
    return {
      ...ClinicianDto.from(row),
      profile: ClinicianProfileDto.from(row.clinicianProfile),
      activatedAt: row.emailVerifiedAt,
      lastLoginAt: row.lastLoginAt,
      assignedChildIds: row.clinicianAssignments.map((a) => a.childId),
    };
  }
}

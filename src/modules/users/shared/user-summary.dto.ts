import { ApiProperty } from '@nestjs/swagger';
import { Role, User, UserStatus } from '@prisma/client';

/**
 * General admin directory row (C1, plan 0008) — distinct from `ClinicianDto`
 * (§3 row 10 of plan 0008): `clinician:list` stays the narrow, CLINICIAN-only feed for
 * the assign-clinician picker; this is the broad directory across every role. Not a
 * reuse of `UserProfileDto` (the self-service `get-me` shape) either, to avoid
 * over-exposing self-only fields to a response shape not designed for admin oversight.
 */
export class UserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: User): UserSummaryDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}

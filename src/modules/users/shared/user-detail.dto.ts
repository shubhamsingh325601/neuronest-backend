import { ApiProperty } from '@nestjs/swagger';
import { Role, User, UserStatus } from '@prisma/client';

/**
 * C1 detail view — embeds relations, not just the bare row (§3 row 11 of plan 0008):
 * the "identity resolution gap" the phase-8 audit flagged. For a `PARENT`, `childId`
 * (their one child, if any — `Child.parentId @unique` makes this a single optional
 * field). For a `CLINICIAN`, `assignedChildIds` from their live
 * `ClinicianChildAssignment` rows. Both `null`/`[]` for an `ADMIN` row.
 */
export class UserDetailDto {
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

  @ApiProperty({ type: String, nullable: true, description: 'PARENT only — their one child, if any.' })
  childId!: string | null;

  @ApiProperty({ type: [String], description: 'CLINICIAN only — every child currently assigned.' })
  assignedChildIds!: string[];

  static from(row: User, childId: string | null, assignedChildIds: string[]): UserDetailDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      childId,
      assignedChildIds,
    };
  }
}

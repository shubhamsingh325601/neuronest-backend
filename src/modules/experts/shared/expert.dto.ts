import { ApiProperty } from '@nestjs/swagger';
import { User, UserStatus } from '@prisma/client';
import type { ExpertDetailRow } from './expert.include';

/** Summary of an EXPERT user, as returned to admin. */
export class ExpertDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Priya Nair' })
  name!: string;

  @ApiProperty({ example: 'priya.nair@expert.example' })
  email!: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: User): ExpertDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}

/** Full admin view of one expert: summary + last login + assigned children. */
export class ExpertDetailDto extends ExpertDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: [String], description: 'Ids of the children this expert is assigned to.' })
  assignedChildIds!: string[];

  static fromDetail(row: ExpertDetailRow): ExpertDetailDto {
    return {
      ...ExpertDto.from(row),
      lastLoginAt: row.lastLoginAt,
      assignedChildIds: row.expertAssignments.map((a) => a.childId),
    };
  }
}

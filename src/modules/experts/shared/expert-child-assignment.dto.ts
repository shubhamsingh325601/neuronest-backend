import { ApiProperty } from '@nestjs/swagger';
import type { ExpertChildAssignment } from '@prisma/client';

/** One expert-child link. */
export class ExpertChildAssignmentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  expertId!: string;

  @ApiProperty()
  childId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: ExpertChildAssignment): ExpertChildAssignmentDto {
    return { id: row.id, expertId: row.expertId, childId: row.childId, createdAt: row.createdAt };
  }
}

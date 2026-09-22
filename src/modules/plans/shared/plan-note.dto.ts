import { ApiProperty } from '@nestjs/swagger';
import { PlanNote } from '@prisma/client';

/** Full representation of a plan note — clinician-to-clinician coordination, not parent-facing. */
export class PlanNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty()
  note!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: PlanNote): PlanNoteDto {
    return {
      id: row.id,
      planId: row.planId,
      authorId: row.authorId,
      note: row.note,
      createdAt: row.createdAt,
    };
  }
}

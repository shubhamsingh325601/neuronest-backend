import { ApiProperty } from '@nestjs/swagger';
import { MonthlyCallLog } from '@prisma/client';

/** Full representation of a monthly call log — not parent-facing (docs/rbac.md). */
export class MonthlyCallLogDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  childId!: string;

  @ApiProperty()
  clinicianId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  calledAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(row: MonthlyCallLog): MonthlyCallLogDto {
    return {
      id: row.id,
      childId: row.childId,
      clinicianId: row.clinicianId,
      calledAt: row.calledAt,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }
}

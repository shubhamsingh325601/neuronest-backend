import { ApiProperty } from '@nestjs/swagger';
import type { ProgressEntry } from '@prisma/client';
import { formatDateOnly } from './date.util';

export class ProgressEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) childId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) planId!: string | null;
  @ApiProperty({ example: '2026-10-04', description: 'Calendar date, YYYY-MM-DD.' })
  entryDate!: string;
  @ApiProperty({ nullable: true, type: Number, minimum: 1, maximum: 5 }) mood!: number | null;
  @ApiProperty({ nullable: true, type: Number, minimum: 1, maximum: 5 }) behaviour!: number | null;
  @ApiProperty({ nullable: true, type: Number, minimum: 0, maximum: 1440 })
  sleepMinutes!: number | null;
  @ApiProperty({ nullable: true, type: String, maxLength: 1000 }) note!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(row: ProgressEntry): ProgressEntryDto {
    const dto = new ProgressEntryDto();
    dto.id = row.id;
    dto.childId = row.childId;
    dto.planId = row.planId;
    dto.entryDate = formatDateOnly(row.entryDate);
    dto.mood = row.mood;
    dto.behaviour = row.behaviour;
    dto.sleepMinutes = row.sleepMinutes;
    dto.note = row.note;
    dto.createdAt = row.createdAt;
    dto.updatedAt = row.updatedAt;
    return dto;
  }
}

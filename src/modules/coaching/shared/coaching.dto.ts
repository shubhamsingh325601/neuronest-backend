import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CoachingTip, Role } from '@prisma/client';

/** One coaching tip. `authorId` is redacted for PARENT callers (plan 0012 decision 9). */
export class CoachingTipDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 1 })
  weekNumber!: number;

  @ApiProperty({ example: 1, description: '1-based order within the week.' })
  position!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ description: 'Present for CLINICIAN/ADMIN only.' })
  authorId?: string;

  static from(row: CoachingTip, role: Role): CoachingTipDto {
    const dto: CoachingTipDto = {
      id: row.id,
      weekNumber: row.weekNumber,
      position: row.position,
      title: row.title,
      body: row.body,
    };
    if (role !== Role.PARENT) {
      dto.authorId = row.authorId;
    }
    return dto;
  }
}

export class CoachingWeekDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Null when no week resolves.' })
  weekNumber!: number | null;

  @ApiProperty({ type: [CoachingTipDto], description: 'Ordered by position; may be empty.' })
  tips!: CoachingTipDto[];
}

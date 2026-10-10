import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { AppointmentClinicianDto } from './appointment-slot.dto';

export class AppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  childId!: string;

  @ApiProperty({ format: 'uuid' })
  slotId!: string;

  @ApiProperty({ type: AppointmentClinicianDto })
  clinician!: AppointmentClinicianDto;

  @ApiProperty({ example: '2026-10-12T09:00:00.000Z', description: 'UTC ISO-8601.' })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-12T09:30:00.000Z', description: 'UTC ISO-8601.' })
  endsAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Video-call link, when the clinician published one.',
  })
  meetingUrl!: string | null;

  @ApiProperty({ type: [String], description: 'Plan-goal ids the parent wants to cover.' })
  prepTopicIds!: string[];

  @ApiProperty({ type: [String], description: 'Preparation steps the parent ticked.' })
  prepChecklistIds!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Written by the clinician after the call.',
  })
  summary!: string | null;

  @ApiProperty({ type: [String] })
  actionPoints!: string[];

  @ApiProperty()
  createdAt!: string;

  static from(row: {
    id: string;
    childId: string;
    createdAt: Date;
    prepTopicIds: string[];
    prepChecklistIds: string[];
    summary: string | null;
    actionPoints: string[];
    slot: {
      id: string;
      startsAt: Date;
      endsAt: Date;
      meetingUrl: string | null;
      clinician: { id: string; name: string };
    };
  }): AppointmentDto {
    return {
      id: row.id,
      childId: row.childId,
      slotId: row.slot.id,
      clinician: { id: row.slot.clinician.id, name: row.slot.clinician.name },
      startsAt: row.slot.startsAt.toISOString(),
      endsAt: row.slot.endsAt.toISOString(),
      meetingUrl: row.slot.meetingUrl,
      prepTopicIds: row.prepTopicIds,
      prepChecklistIds: row.prepChecklistIds,
      summary: row.summary,
      actionPoints: row.actionPoints,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Prisma `include` that every appointment read uses, so `AppointmentDto.from` always has what it needs. */
export const APPOINTMENT_INCLUDE = {
  slot: { include: { clinician: { select: { id: true, name: true } } } },
} satisfies Prisma.AppointmentInclude;

export class ListAppointmentsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['upcoming', 'past'],
    description:
      'upcoming = not yet ended, soonest first; past = ended, newest first. Omitted = all, newest first.',
  })
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  when?: 'upcoming' | 'past';
}

export class ListAppointmentsResponseDto {
  @ApiProperty({ type: [AppointmentDto] })
  data!: AppointmentDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

/** Slot-time filter and ordering for `?when=`. */
export function whenClause(when: 'upcoming' | 'past' | undefined, now: Date) {
  const where: Prisma.AppointmentWhereInput =
    when === 'upcoming'
      ? { slot: { endsAt: { gt: now } } }
      : when === 'past'
        ? { slot: { endsAt: { lte: now } } }
        : {};
  const direction = when === 'upcoming' ? 'asc' : 'desc';
  const orderBy: Prisma.AppointmentOrderByWithRelationInput[] = [
    { slot: { startsAt: direction } },
    { id: direction },
  ];
  return { where, orderBy };
}

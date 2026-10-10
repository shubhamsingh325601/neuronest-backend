import { ApiProperty } from '@nestjs/swagger';

/** A slot as its owning clinician sees it: includes the call link and whether a parent booked it. */
export class OwnSlotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-10-12T09:00:00.000Z', description: 'UTC ISO-8601.' })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-12T09:30:00.000Z', description: 'UTC ISO-8601.' })
  endsAt!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Video-call link, when one was set.' })
  meetingUrl!: string | null;

  @ApiProperty({ description: 'True once a parent has booked the slot.' })
  booked!: boolean;

  @ApiProperty()
  createdAt!: string;

  static from(row: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    meetingUrl: string | null;
    createdAt: Date;
    appointment: { id: string } | null;
  }): OwnSlotDto {
    return {
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      meetingUrl: row.meetingUrl,
      booked: row.appointment !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

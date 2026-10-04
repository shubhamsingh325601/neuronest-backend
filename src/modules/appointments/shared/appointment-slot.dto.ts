import { ApiProperty } from '@nestjs/swagger';

/** Clinician identity exposed on appointment surfaces: id and name only (plan 0014 §3 row 7). */
export class AppointmentClinicianDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AppointmentSlotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: AppointmentClinicianDto })
  clinician!: AppointmentClinicianDto;

  @ApiProperty({ example: '2026-10-12T09:00:00.000Z', description: 'UTC ISO-8601.' })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-12T09:30:00.000Z', description: 'UTC ISO-8601.' })
  endsAt!: string;

  @ApiProperty()
  createdAt!: string;

  static from(row: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    createdAt: Date;
    clinician: { id: string; name: string };
  }): AppointmentSlotDto {
    return {
      id: row.id,
      clinician: { id: row.clinician.id, name: row.clinician.name },
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

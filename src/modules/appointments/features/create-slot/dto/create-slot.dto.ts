import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

export class CreateSlotDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required for ADMIN; a CLINICIAN may only omit it or pass their own id.',
  })
  @IsOptional()
  @IsUUID()
  clinicianId?: string;

  @ApiProperty({
    example: '2026-10-12T09:00:00.000Z',
    description: 'ISO 8601 date-time, in the future.',
  })
  @IsDateString()
  @Matches(DATE_TIME, { message: 'startsAt must be an ISO 8601 date-time' })
  startsAt!: string;

  @ApiProperty({
    example: '2026-10-12T09:30:00.000Z',
    description: 'ISO 8601 date-time, after startsAt, at most 2 hours later.',
  })
  @IsDateString()
  @Matches(DATE_TIME, { message: 'endsAt must be an ISO 8601 date-time' })
  endsAt!: string;
}

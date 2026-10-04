import { ApiProperty } from '@nestjs/swagger';
import { MediaConsent } from '@prisma/client';

export const CONSENT_STATUSES = ['GRANTED', 'WITHDRAWN', 'NONE'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** One consent grant. `grantedById` is deliberately not exposed. */
export class ConsentRecordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'v1' })
  consentVersion!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  grantedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  supersededAt!: Date | null;

  static from(row: MediaConsent): ConsentRecordDto {
    return {
      id: row.id,
      consentVersion: row.consentVersion,
      grantedAt: row.grantedAt,
      withdrawnAt: row.withdrawnAt,
      supersededAt: row.supersededAt,
    };
  }
}

export class ConsentStateDto {
  @ApiProperty({ enum: CONSENT_STATUSES })
  status!: ConsentStatus;

  @ApiProperty({ type: ConsentRecordDto, nullable: true })
  current!: ConsentRecordDto | null;

  @ApiProperty({ type: [ConsentRecordDto], description: 'Newest first, capped at 50.' })
  history!: ConsentRecordDto[];
}

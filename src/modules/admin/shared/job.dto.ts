import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, type Job, type Prisma } from '@prisma/client';

/**
 * Admin view of a queue row. `payload` is included — payloads never hold secrets by
 * construction (plan 0011 §3 row 7), so it is safe to show.
 */
export class JobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: JobStatus })
  status!: JobStatus;

  @ApiProperty()
  priority!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Prisma.JsonValue;

  @ApiProperty()
  runAt!: Date;

  @ApiProperty()
  attempts!: number;

  @ApiProperty()
  maxAttempts!: number;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;

  @ApiProperty({ type: Date, nullable: true })
  lockedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  dedupeKey!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt!: Date | null;

  static from(job: Job): JobDto {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      payload: job.payload,
      runAt: job.runAt,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      lockedAt: job.lockedAt,
      dedupeKey: job.dedupeKey,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  }
}

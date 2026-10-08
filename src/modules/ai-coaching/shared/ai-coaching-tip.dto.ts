import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiOutputStatus, type AiOutput } from '@prisma/client';
import { AI_DISCLAIMER, PENDING_STALE_MS, type FailureReason } from './ai-coaching.constants';
import { coachingTipSchema, type CoachingTipContent } from './coaching-tip.schema';

export const TIP_STATUSES = ['READY', 'PENDING', 'UNAVAILABLE', 'NONE'] as const;
export const TIP_REASONS = ['DISABLED', 'CAPACITY', 'PROVIDER', 'BLOCKED'] as const;
export type AiCoachingTipStatus = (typeof TIP_STATUSES)[number];
export type AiCoachingTipReason = (typeof TIP_REASONS)[number];

export class AiCoachingTipContentDto {
  @ApiProperty({ example: 'A calm start to bedtime' }) headline!: string;
  @ApiProperty({ description: 'Plain text. No markdown or HTML.' }) body!: string;
  @ApiProperty({ type: [String], description: 'One to three small steps, plain text.' })
  tryThis!: string[];
}

/** Public reason for an internal failure code. Anything not parent-meaningful reads as `PROVIDER`. */
function publicReason(reason: string | null): AiCoachingTipReason {
  if (reason === 'DISABLED' || reason === 'CAPACITY' || reason === 'BLOCKED') return reason;
  return 'PROVIDER';
}

/**
 * The parent-facing AI tip (plan 0018 §5). `aiGenerated` and `disclaimer` are server constants,
 * never model output. `promptVersion`, provider and model are deliberately not exposed.
 */
export class AiCoachingTipDto {
  @ApiProperty({ enum: TIP_STATUSES, description: '`NONE` only from GET: nothing generated today.' })
  status!: AiCoachingTipStatus;

  @ApiProperty({ type: AiCoachingTipContentDto, nullable: true })
  tip!: AiCoachingTipContentDto | null;

  @ApiPropertyOptional({ enum: TIP_REASONS, description: 'Present when `status` is `UNAVAILABLE`.' })
  reason?: AiCoachingTipReason;

  @ApiProperty({ example: true }) aiGenerated!: true;

  @ApiProperty({ example: AI_DISCLAIMER }) disclaimer!: string;

  @ApiProperty({ example: '2026-10-05', description: 'The UTC day this tip is for.' })
  forDate!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  generatedAt?: Date;

  private static base(forDate: string): AiCoachingTipDto {
    return {
      status: 'NONE',
      tip: null,
      aiGenerated: true,
      disclaimer: AI_DISCLAIMER,
      forDate,
    };
  }

  static none(forDate: string): AiCoachingTipDto {
    return this.base(forDate);
  }

  static unavailable(forDate: string, reason: AiCoachingTipReason): AiCoachingTipDto {
    return { ...this.base(forDate), status: 'UNAVAILABLE', reason };
  }

  static pending(forDate: string): AiCoachingTipDto {
    return { ...this.base(forDate), status: 'PENDING' };
  }

  /** Presents a stored row. A `PENDING` row nobody is working on any more reads as unavailable. */
  static fromRow(row: AiOutput, forDate: string, now: Date = new Date()): AiCoachingTipDto {
    if (row.status === AiOutputStatus.READY) {
      const parsed = coachingTipSchema.safeParse(row.content);
      if (!parsed.success) return this.unavailable(forDate, 'PROVIDER');
      return {
        ...this.base(forDate),
        status: 'READY',
        tip: toContent(parsed.data),
        generatedAt: row.updatedAt,
      };
    }
    if (row.status === AiOutputStatus.PENDING) {
      return isStalePending(row, now) ? this.unavailable(forDate, 'PROVIDER') : this.pending(forDate);
    }
    return this.unavailable(forDate, publicReason(row.failureReason as FailureReason | null));
  }
}

function toContent(content: CoachingTipContent): AiCoachingTipContentDto {
  return { headline: content.headline, body: content.body, tryThis: content.tryThis };
}

export function isStalePending(row: Pick<AiOutput, 'status' | 'updatedAt'>, now: Date): boolean {
  return (
    row.status === AiOutputStatus.PENDING && now.getTime() - row.updatedAt.getTime() > PENDING_STALE_MS
  );
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsDateOnlyNotFuture } from '@common/validation/is-date-only-not-future.decorator';

export class WeeklySummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-28',
    description:
      'Any date in the wanted Monday–Sunday (UTC) week; normalised to that week\'s Monday. Defaults to the previous full week.',
  })
  @IsOptional()
  @IsDateOnlyNotFuture()
  weekStart?: string;
}

export class MetricStatsDto {
  @ApiProperty({ nullable: true, type: Number }) average!: number | null;
  @ApiProperty({ nullable: true, type: Number }) min!: number | null;
  @ApiProperty({ nullable: true, type: Number }) max!: number | null;
}

export class SummaryPlanDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
}

export class WeeklySummaryDto {
  @ApiProperty({ example: '2026-09-28' }) weekStart!: string;
  @ApiProperty({ example: '2026-10-04' }) weekEnd!: string;
  @ApiProperty({ description: 'Days in the week with an entry (0–7).' }) daysLogged!: number;
  @ApiProperty({ type: MetricStatsDto }) mood!: MetricStatsDto;
  @ApiProperty({ type: MetricStatsDto }) behaviour!: MetricStatsDto;
  @ApiProperty({ type: MetricStatsDto }) sleepMinutes!: MetricStatsDto;
  @ApiProperty({
    enum: ['UP', 'DOWN', 'FLAT'],
    nullable: true,
    type: String,
    description:
      'Combined mood+behaviour average vs the prior week; null when either week has no data.',
  })
  trend!: 'UP' | 'DOWN' | 'FLAT' | null;
  @ApiProperty({
    type: SummaryPlanDto,
    nullable: true,
    description: "The child's ACTIVE plan now, if any — informational only.",
  })
  activePlan!: SummaryPlanDto | null;
}

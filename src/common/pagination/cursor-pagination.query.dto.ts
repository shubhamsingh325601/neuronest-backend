import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Server default when `?limit=` is omitted. */
export const DEFAULT_PAGE_LIMIT = 20;
/** Hard cap — a larger `?limit=` is a validation error, not silently clamped. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Shared query shape for cursor-paginated list endpoints. See
 * [docs/api-conventions.md](../../../docs/api-conventions.md#pagination) — cursors, not
 * offsets, because list contents shift while they are being paged.
 */
export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: "Opaque cursor copied from a previous response's `nextCursor`.",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { IsDateOnlyNotFuture } from '@common/validation/is-date-only-not-future.decorator';
import { ProgressEntryDto } from '@modules/progress/shared/progress.dto';

export class ListProgressQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Earliest entryDate (inclusive).' })
  @IsOptional()
  @IsDateOnlyNotFuture()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-04', description: 'Latest entryDate (inclusive).' })
  @IsOptional()
  @IsDateOnlyNotFuture()
  to?: string;
}

export class ListProgressResponseDto {
  @ApiProperty({ type: [ProgressEntryDto] })
  data!: ProgressEntryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

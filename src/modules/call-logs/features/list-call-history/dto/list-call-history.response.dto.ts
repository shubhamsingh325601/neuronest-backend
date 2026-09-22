import { ApiProperty } from '@nestjs/swagger';
import { MonthlyCallLogDto } from '@modules/call-logs/shared/monthly-call-log.dto';

export class ListCallHistoryResponseDto {
  @ApiProperty({ type: [MonthlyCallLogDto] })
  data!: MonthlyCallLogDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

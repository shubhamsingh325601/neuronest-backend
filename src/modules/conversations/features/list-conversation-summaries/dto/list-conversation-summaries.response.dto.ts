import { ApiProperty } from '@nestjs/swagger';
import { ConversationSummaryDto } from '@modules/conversations/shared/conversation-summary.dto';

export class ListConversationSummariesResponseDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  data!: ConversationSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

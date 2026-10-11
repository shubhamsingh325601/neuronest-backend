import { ApiProperty } from '@nestjs/swagger';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';

export class ListConversationsResponseDto {
  @ApiProperty({ type: [ConversationDto] })
  data!: ConversationDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

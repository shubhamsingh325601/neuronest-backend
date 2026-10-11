import { ApiProperty } from '@nestjs/swagger';
import { MessageDto } from '@modules/conversations/shared/conversation.dto';

export class ListMessagesResponseDto {
  @ApiProperty({
    description: 'True once the raw messages were deleted; only the summary remains.',
  })
  purged!: boolean;

  @ApiProperty({ type: [MessageDto], description: 'In seq order, oldest first.' })
  items!: MessageDto[];
}

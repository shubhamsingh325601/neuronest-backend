import { ApiProperty } from '@nestjs/swagger';
import type { ChatTopicKind } from '@modules/conversations/shared/ai-chat.constants';

export class AiChatTopicDto {
  @ApiProperty({
    description:
      'For `AI` topics this is the value to send when opening a chat. `ROUTE` and `UNAVAILABLE` entries are not chats.',
  })
  id!: string;

  @ApiProperty() label!: string;
  @ApiProperty() description!: string;

  @ApiProperty({
    enum: ['AI', 'ROUTE', 'UNAVAILABLE'],
    description:
      '`AI`: open an AI chat. `ROUTE`: the app opens another screen (booking, expert chat). `UNAVAILABLE`: show "coming soon".',
  })
  kind!: ChatTopicKind;
}

export class ListAiChatTopicsResponseDto {
  @ApiProperty({ description: 'Changes whenever the list or its wording changes.' })
  version!: number;

  @ApiProperty({ type: [AiChatTopicDto] })
  data!: AiChatTopicDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { AI_CHAT_TOPIC_IDS } from '@modules/conversations/shared/ai-chat.constants';

export class CreateAiConversationDto {
  @ApiProperty({
    enum: AI_CHAT_TOPIC_IDS,
    description:
      'An `AI` topic from `GET /ai-chat/topics`. A `ROUTE` or `UNAVAILABLE` topic is refused with 422.',
  })
  @IsString()
  @IsIn(AI_CHAT_TOPIC_IDS)
  topic!: string;
}

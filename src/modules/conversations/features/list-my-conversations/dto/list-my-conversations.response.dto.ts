import { ApiProperty } from '@nestjs/swagger';
import { ConversationDto } from '@modules/conversations/shared/conversation.dto';

export class MyConversationChildDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class MyConversationDto extends ConversationDto {
  @ApiProperty({ type: MyConversationChildDto })
  child!: MyConversationChildDto;
}

export class ListMyConversationsResponseDto {
  @ApiProperty({ type: [MyConversationDto] })
  data!: MyConversationDto[];
}

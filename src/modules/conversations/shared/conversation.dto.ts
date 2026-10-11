import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AiChatTopic,
  ConversationKind,
  ConversationStatus,
  MessageSender,
  MessageState,
  SummaryStatus,
} from '@prisma/client';

/** Conversation metadata. Never carries message text. */
export class ConversationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ConversationKind }) kind!: ConversationKind;
  @ApiProperty({ enum: AiChatTopic, nullable: true }) topic!: AiChatTopic | null;
  @ApiProperty({ format: 'uuid' }) childId!: string;
  @ApiProperty({ enum: ConversationStatus }) status!: ConversationStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastMessageAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: Date | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set once the raw messages were deleted; only the summary remains.',
  })
  messagesPurgedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({
    enum: SummaryStatus,
    nullable: true,
    description: 'Present on the list; null while no summary exists.',
  })
  summaryStatus?: SummaryStatus | null;

  static from(row: {
    id: string;
    kind: ConversationKind;
    topic: AiChatTopic | null;
    childId: string;
    status: ConversationStatus;
    lastMessageAt: Date | null;
    closedAt: Date | null;
    messagesPurgedAt: Date | null;
    createdAt: Date;
  }): ConversationDto {
    return {
      id: row.id,
      kind: row.kind,
      topic: row.topic,
      childId: row.childId,
      status: row.status,
      lastMessageAt: row.lastMessageAt,
      closedAt: row.closedAt,
      messagesPurgedAt: row.messagesPurgedAt,
      createdAt: row.createdAt,
    };
  }
}

export class MessageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Position in the conversation, starting at 1.' }) seq!: number;
  @ApiProperty({ enum: MessageSender }) sender!: MessageSender;
  @ApiProperty({ enum: MessageState }) state!: MessageState;
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, nullable: true }) clientMessageId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;

  static from(row: {
    id: string;
    seq: number;
    sender: MessageSender;
    state: MessageState;
    body: string;
    clientMessageId: string | null;
    createdAt: Date;
  }): MessageDto {
    return {
      id: row.id,
      seq: row.seq,
      sender: row.sender,
      state: row.state,
      body: row.body,
      clientMessageId: row.clientMessageId,
      createdAt: row.createdAt,
    };
  }
}

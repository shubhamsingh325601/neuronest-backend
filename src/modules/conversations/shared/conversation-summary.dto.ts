import { ApiProperty } from '@nestjs/swagger';
import { ConversationKind, SummaryStatus } from '@prisma/client';
import { SUMMARY_THEMES } from './conversation-summary.content';

export class ConversationSummaryContentDto {
  @ApiProperty() overview!: string;
  @ApiProperty({ enum: SUMMARY_THEMES, isArray: true }) themes!: string[];
  @ApiProperty({ type: [String] }) parentConcerns!: string[];
  @ApiProperty({ type: [String] }) guidanceGiven!: string[];
  @ApiProperty({ type: [String] }) openQuestions!: string[];
  @ApiProperty() followUpSuggested!: boolean;
  @ApiProperty({ enum: ConversationKind }) participantsKind!: ConversationKind;
}

/** The summary of one closed chat. The raw messages are never part of it. */
export class ConversationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ format: 'uuid' }) childId!: string;
  @ApiProperty({ enum: ConversationKind }) kind!: ConversationKind;
  @ApiProperty({ enum: SummaryStatus }) status!: SummaryStatus;
  @ApiProperty({
    type: ConversationSummaryContentDto,
    nullable: true,
    description: 'Null until the status is READY.',
  })
  content!: ConversationSummaryContentDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set when the status is PLACEHOLDER: why there is no summary.',
  })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) generatedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  conversationClosedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;

  static from(row: {
    id: string;
    conversationId: string;
    childId: string;
    status: SummaryStatus;
    content: unknown;
    generatedAt: Date | null;
    createdAt: Date;
    conversation: { kind: ConversationKind; closedAt: Date | null; messagesPurgedAt: Date | null };
  }): ConversationSummaryDto {
    const removedOn = (row.conversation.messagesPurgedAt ?? row.createdAt)
      .toISOString()
      .slice(0, 10);
    return {
      id: row.id,
      conversationId: row.conversationId,
      childId: row.childId,
      kind: row.conversation.kind,
      status: row.status,
      content:
        row.status === SummaryStatus.READY ? (row.content as ConversationSummaryContentDto) : null,
      note:
        row.status === SummaryStatus.PLACEHOLDER
          ? `Summary unavailable; the conversation was removed on ${removedOn}.`
          : null,
      generatedAt: row.generatedAt,
      conversationClosedAt: row.conversation.closedAt,
      createdAt: row.createdAt,
    };
  }
}

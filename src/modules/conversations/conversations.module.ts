import { Module } from '@nestjs/common';
import { CloseConversationController } from './features/close-conversation/close-conversation.controller';
import { CloseConversationService } from './features/close-conversation/close-conversation.service';
import { CreateConversationController } from './features/create-conversation/create-conversation.controller';
import { CreateConversationService } from './features/create-conversation/create-conversation.service';
import { GetConversationSummaryController } from './features/get-conversation-summary/get-conversation-summary.controller';
import { GetConversationSummaryService } from './features/get-conversation-summary/get-conversation-summary.service';
import { ListConversationSummariesController } from './features/list-conversation-summaries/list-conversation-summaries.controller';
import { ListConversationSummariesService } from './features/list-conversation-summaries/list-conversation-summaries.service';
import { ListConversationsController } from './features/list-conversations/list-conversations.controller';
import { ListConversationsService } from './features/list-conversations/list-conversations.service';
import { ListMessagesController } from './features/list-messages/list-messages.controller';
import { ListMessagesService } from './features/list-messages/list-messages.service';
import { SendMessageController } from './features/send-message/send-message.controller';
import { SendMessageService } from './features/send-message/send-message.service';
import { ConversationSummaryJobs } from './jobs/conversation-summary.jobs';
import { ConversationJobs } from './jobs/conversation.jobs';

/**
 * Parent-to-expert chat sessions (plan 0019). Postgres is the only store of message text; the
 * retention jobs close idle sessions and hard-delete their messages. Closing queues an AI summary, which
 * is all that remains once the messages are purged.
 */
@Module({
  controllers: [
    CreateConversationController,
    SendMessageController,
    ListMessagesController,
    CloseConversationController,
    ListConversationsController,
    GetConversationSummaryController,
    ListConversationSummariesController,
  ],
  providers: [
    CreateConversationService,
    SendMessageService,
    ListMessagesService,
    CloseConversationService,
    ListConversationsService,
    GetConversationSummaryService,
    ListConversationSummariesService,
    ConversationJobs,
    ConversationSummaryJobs,
  ],
})
export class ConversationsModule {}

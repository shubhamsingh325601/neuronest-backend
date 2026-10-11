import { Module } from '@nestjs/common';
import { CloseConversationController } from './features/close-conversation/close-conversation.controller';
import { CloseConversationService } from './features/close-conversation/close-conversation.service';
import { CreateConversationController } from './features/create-conversation/create-conversation.controller';
import { CreateConversationService } from './features/create-conversation/create-conversation.service';
import { ListConversationsController } from './features/list-conversations/list-conversations.controller';
import { ListConversationsService } from './features/list-conversations/list-conversations.service';
import { ListMessagesController } from './features/list-messages/list-messages.controller';
import { ListMessagesService } from './features/list-messages/list-messages.service';
import { SendMessageController } from './features/send-message/send-message.controller';
import { SendMessageService } from './features/send-message/send-message.service';
import { ConversationJobs } from './jobs/conversation.jobs';

/**
 * Parent-to-expert chat sessions (plan 0019). Postgres is the only store of message text; the
 * retention jobs close idle sessions and hard-delete their messages. The summary comes in a later batch.
 */
@Module({
  controllers: [
    CreateConversationController,
    SendMessageController,
    ListMessagesController,
    CloseConversationController,
    ListConversationsController,
  ],
  providers: [
    CreateConversationService,
    SendMessageService,
    ListMessagesService,
    CloseConversationService,
    ListConversationsService,
    ConversationJobs,
  ],
})
export class ConversationsModule {}

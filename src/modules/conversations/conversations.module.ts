import { Module } from '@nestjs/common';
import { AiCoachingModule } from '@modules/ai-coaching/ai-coaching.module';
import { ChildrenModule } from '@modules/children/children.module';
import { PlansModule } from '@modules/plans/plans.module';
import { ProgressModule } from '@modules/progress/progress.module';
import { CloseConversationController } from './features/close-conversation/close-conversation.controller';
import { CloseConversationService } from './features/close-conversation/close-conversation.service';
import { CreateAiConversationController } from './features/create-ai-conversation/create-ai-conversation.controller';
import { CreateAiConversationService } from './features/create-ai-conversation/create-ai-conversation.service';
import { CreateConversationController } from './features/create-conversation/create-conversation.controller';
import { CreateConversationService } from './features/create-conversation/create-conversation.service';
import { GetConversationSummaryController } from './features/get-conversation-summary/get-conversation-summary.controller';
import { GetConversationSummaryService } from './features/get-conversation-summary/get-conversation-summary.service';
import { ListAiChatTopicsController } from './features/list-ai-chat-topics/list-ai-chat-topics.controller';
import { ListAiChatTopicsService } from './features/list-ai-chat-topics/list-ai-chat-topics.service';
import { ListConversationSummariesController } from './features/list-conversation-summaries/list-conversation-summaries.controller';
import { ListConversationSummariesService } from './features/list-conversation-summaries/list-conversation-summaries.service';
import { ListConversationsController } from './features/list-conversations/list-conversations.controller';
import { ListConversationsService } from './features/list-conversations/list-conversations.service';
import { ListMessagesController } from './features/list-messages/list-messages.controller';
import { ListMessagesService } from './features/list-messages/list-messages.service';
import { SendAiMessageController } from './features/send-ai-message/send-ai-message.controller';
import { SendAiMessageService } from './features/send-ai-message/send-ai-message.service';
import { SendMessageController } from './features/send-message/send-message.controller';
import { SendMessageService } from './features/send-message/send-message.service';
import { ConversationSummaryJobs } from './jobs/conversation-summary.jobs';
import { ConversationJobs } from './jobs/conversation.jobs';
import { AiChatContextBuilder } from './shared/ai-chat-context.builder';

/**
 * Chat sessions (plan 0019): parent-to-expert, and the parent's guided AI chat. Postgres is the only
 * store of message text; the retention jobs close idle sessions and hard-delete their messages. Closing
 * queues an AI summary, which is all that remains once the messages are purged. The AI chat reads the
 * child, plan and progress only through those modules' exported services.
 */
@Module({
  imports: [AiCoachingModule, ChildrenModule, PlansModule, ProgressModule],
  controllers: [
    ListAiChatTopicsController,
    CreateAiConversationController,
    SendAiMessageController,
    CreateConversationController,
    SendMessageController,
    ListMessagesController,
    CloseConversationController,
    ListConversationsController,
    GetConversationSummaryController,
    ListConversationSummariesController,
  ],
  providers: [
    ListAiChatTopicsService,
    CreateAiConversationService,
    SendAiMessageService,
    AiChatContextBuilder,
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

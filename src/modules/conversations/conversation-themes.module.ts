import { Module } from '@nestjs/common';
import { RecentSummaryThemesReader } from './shared/recent-summary-themes.reader';

/**
 * Leaf module exposing the summary themes to AI features. It exists so `AiCoachingModule` can read them
 * without importing `ConversationsModule`, which already imports `AiCoachingModule`.
 */
@Module({
  providers: [RecentSummaryThemesReader],
  exports: [RecentSummaryThemesReader],
})
export class ConversationThemesModule {}

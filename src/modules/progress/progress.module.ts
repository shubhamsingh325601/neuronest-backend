import { Module } from '@nestjs/common';
import { ListProgressController } from './features/list-progress/list-progress.controller';
import { ListProgressService } from './features/list-progress/list-progress.service';
import { UpsertProgressController } from './features/upsert-progress/upsert-progress.controller';
import { UpsertProgressService } from './features/upsert-progress/upsert-progress.service';
import { WeeklySummaryController } from './features/weekly-summary/weekly-summary.controller';
import { WeeklySummaryService } from './features/weekly-summary/weekly-summary.service';

/** Per-child daily progress log and computed weekly summary (Phase 13). */
@Module({
  // WeeklySummaryController first: its static `progress/weekly-summary` path must not be
  // shadowed by the `progress/:entryDate` route.
  controllers: [UpsertProgressController, WeeklySummaryController, ListProgressController],
  providers: [UpsertProgressService, ListProgressService, WeeklySummaryService],
})
export class ProgressModule {}

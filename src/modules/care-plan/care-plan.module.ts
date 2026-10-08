import { Module } from '@nestjs/common';
import { UpsertPlanWeekController } from './features/upsert-plan-week/upsert-plan-week.controller';
import { UpsertPlanWeekService } from './features/upsert-plan-week/upsert-plan-week.service';
import { GetCarePlanController } from './features/get-care-plan/get-care-plan.controller';
import { GetCarePlanService } from './features/get-care-plan/get-care-plan.service';
import { CompleteActivityController } from './features/complete-activity/complete-activity.controller';
import { CompleteActivityService } from './features/complete-activity/complete-activity.service';
import { ResetActivityController } from './features/reset-activity/reset-activity.controller';
import { ResetActivityService } from './features/reset-activity/reset-activity.service';

/**
 * Structured care-plan content (plan 0017 batch B): weeks, goals and scheduled activities that clinicians
 * author per plan, plus the parent's activity completions.
 */
@Module({
  controllers: [
    UpsertPlanWeekController,
    GetCarePlanController,
    CompleteActivityController,
    ResetActivityController,
  ],
  providers: [
    UpsertPlanWeekService,
    GetCarePlanService,
    CompleteActivityService,
    ResetActivityService,
  ],
})
export class CarePlanModule {}

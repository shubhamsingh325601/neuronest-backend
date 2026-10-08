import { Module } from '@nestjs/common';
import { ChildrenModule } from '@modules/children/children.module';
import { CoachingModule } from '@modules/coaching/coaching.module';
import { PlansModule } from '@modules/plans/plans.module';
import { ProgressModule } from '@modules/progress/progress.module';
import { GenerateCoachingTipController } from './features/generate-coaching-tip/generate-coaching-tip.controller';
import { GenerateCoachingTipService } from './features/generate-coaching-tip/generate-coaching-tip.service';
import { GetCoachingTipController } from './features/get-coaching-tip/get-coaching-tip.controller';
import { GetCoachingTipService } from './features/get-coaching-tip/get-coaching-tip.service';
import { AiCoachingJobs } from './jobs/ai-coaching.jobs';
import { AiAccessService } from './shared/ai-access.service';
import { CoachingContextBuilder } from './shared/coaching-context.builder';
import { CoachingTipGenerator } from './shared/coaching-tip.generator';

/**
 * Parent AI coaching tip (Phase 18). Reads child, plan, progress and coaching data only through
 * those modules' exported services, called with the real caller — never their tables.
 */
@Module({
  imports: [ChildrenModule, PlansModule, ProgressModule, CoachingModule],
  controllers: [GenerateCoachingTipController, GetCoachingTipController],
  providers: [
    AiAccessService,
    CoachingContextBuilder,
    CoachingTipGenerator,
    GenerateCoachingTipService,
    GetCoachingTipService,
    AiCoachingJobs,
  ],
})
export class AiCoachingModule {}

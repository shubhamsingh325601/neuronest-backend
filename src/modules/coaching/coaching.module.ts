import { Module } from '@nestjs/common';
import { ListCoachingController } from './features/list-coaching/list-coaching.controller';
import { ListCoachingService } from './features/list-coaching/list-coaching.service';
import { ReplaceCoachingController } from './features/replace-coaching/replace-coaching.controller';
import { ReplaceCoachingService } from './features/replace-coaching/replace-coaching.service';

/** Manually authored weekly coaching tips per plan (Phase 12). AI generation is out of scope. */
@Module({
  controllers: [ReplaceCoachingController, ListCoachingController],
  providers: [ReplaceCoachingService, ListCoachingService],
})
export class CoachingModule {}

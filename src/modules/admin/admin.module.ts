import { Module } from '@nestjs/common';
import { GetJobController } from './features/get-job/get-job.controller';
import { GetJobService } from './features/get-job/get-job.service';
import { GetSummaryController } from './features/get-summary/get-summary.controller';
import { GetSummaryService } from './features/get-summary/get-summary.service';
import { ListJobsController } from './features/list-jobs/list-jobs.controller';
import { ListJobsService } from './features/list-jobs/list-jobs.service';
import { RequeueJobController } from './features/requeue-job/requeue-job.controller';
import { RequeueJobService } from './features/requeue-job/requeue-job.service';
import { RunJobsNowController } from './features/run-jobs-now/run-jobs-now.controller';

/**
 * Admin domain (Phase 8, D1; job surface in Phase 11). Owns no domain's writes except the
 * job queue's admin actions, otherwise only reads across domains via `PrismaService`
 * directly — same "no repository layer, Prisma is the data-access layer" convention as
 * every other feature module.
 */
@Module({
  controllers: [
    GetSummaryController,
    ListJobsController,
    GetJobController,
    RequeueJobController,
    RunJobsNowController,
  ],
  providers: [GetSummaryService, ListJobsService, GetJobService, RequeueJobService],
})
export class AdminModule {}

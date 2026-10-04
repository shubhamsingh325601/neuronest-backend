import { Module } from '@nestjs/common';
import { JobsTokenGuard } from './features/run-due/jobs-token.guard';
import { RunDueController } from './features/run-due/run-due.controller';

/** HTTP surface of the job queue (queue core lives in `@common/jobs`). */
@Module({
  controllers: [RunDueController],
  providers: [JobsTokenGuard],
})
export class JobsHttpModule {}

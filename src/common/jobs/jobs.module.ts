import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@common/prisma/prisma.module';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import { JobRunnerService } from './job-runner.service';
import { JobSweepService } from './job-sweep.service';

@Global()
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [JobHandlerRegistry, JobRunnerService, JobQueueService, JobSweepService],
  exports: [JobHandlerRegistry, JobQueueService, JobRunnerService, JobSweepService],
})
export class JobsModule {}

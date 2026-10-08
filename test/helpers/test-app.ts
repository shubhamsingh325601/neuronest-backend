import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '@app/app.module';
import { AiService } from '@common/ai/ai.service';
import { configureApp } from '@common/bootstrap/configure-app';
import { EmailService } from '@common/email/email.service';
import { JobQueueService } from '@common/jobs/job-queue.service';
import { JobRunnerService, type RunSummary } from '@common/jobs/job-runner.service';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { FakeAiService } from './fake-ai.service';
import { FakeEmailService } from './fake-email.service';
import { FakeMediaStorageService } from './fake-media-storage.service';

export interface TestJobs {
  runner: JobRunnerService;
  queue: JobQueueService;
  /** Run due jobs until none are claimed; returns the summed outcome counts. Backoff is
   *  respected — move a row's `runAt` back first to force a retry to be due. */
  drain: () => Promise<RunSummary>;
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  jobs: TestJobs;
  mail: FakeEmailService;
  ai: FakeAiService;
  mediaStorage: FakeMediaStorageService;
  close: () => Promise<void>;
}

/**
 * Boots the full application for e2e tests, mirroring main.ts, but with the email and
 * media storage providers swapped for in-memory fakes. Also mounts the OpenAPI routes
 * so the docs test can hit /openapi.json.
 */
export async function createTestApp(): Promise<TestContext> {
  const mail = new FakeEmailService();
  const mediaStorage = new FakeMediaStorageService();
  const ai = new FakeAiService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(mail)
    .overrideProvider(MediaStorageService)
    .useValue(mediaStorage)
    .overrideProvider(AiService)
    .useValue(ai)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);

  await app.init();

  const prisma = app.get(PrismaService);
  await prisma.truncateAll();

  const runner = app.get(JobRunnerService);
  const queue = app.get(JobQueueService);
  const jobs: TestJobs = {
    runner,
    queue,
    drain: async () => {
      const total: RunSummary = { claimed: 0, succeeded: 0, retried: 0, dead: 0 };
      for (let i = 0; i < 20; i++) {
        const run = await runner.runDue();
        if (run.claimed === 0) break;
        total.claimed += run.claimed;
        total.succeeded += run.succeeded;
        total.retried += run.retried;
        total.dead += run.dead;
      }
      return total;
    },
  };

  return {
    app,
    prisma,
    jobs,
    mail,
    ai,
    mediaStorage,
    close: async () => {
      await prisma.truncateAll();
      await app.close();
    },
  };
}

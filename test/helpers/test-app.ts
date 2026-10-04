import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '@app/app.module';
import { configureApp, type ConfigureAppOptions } from '@common/bootstrap/configure-app';
import { EmailService } from '@common/email/email.service';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { FakeEmailService } from './fake-email.service';
import { FakeMediaStorageService } from './fake-media-storage.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  mail: FakeEmailService;
  mediaStorage: FakeMediaStorageService;
  close: () => Promise<void>;
}

/**
 * Boots the full application for e2e tests, mirroring main.ts, but with the email and
 * media storage providers swapped for in-memory fakes. Also mounts the OpenAPI routes
 * so the docs test can hit /openapi.json.
 */
export async function createTestApp(options: ConfigureAppOptions = {}): Promise<TestContext> {
  const mail = new FakeEmailService();
  const mediaStorage = new FakeMediaStorageService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(mail)
    .overrideProvider(MediaStorageService)
    .useValue(mediaStorage)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, { trustProxyHops: options.trustProxyHops });

  await app.init();

  const prisma = app.get(PrismaService);
  await prisma.truncateAll();

  return {
    app,
    prisma,
    mail,
    mediaStorage,
    close: async () => {
      await prisma.truncateAll();
      await app.close();
    },
  };
}

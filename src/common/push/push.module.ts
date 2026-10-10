import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import { createPushService } from './push-provider.factory';
import { PushNotifier } from './push-notifier';
import { PushService } from './push.service';

@Global()
@Module({
  providers: [
    { provide: PushService, useFactory: createPushService, inject: [ConfigService, PrismaService] },
    PushNotifier,
  ],
  exports: [PushService, PushNotifier],
})
export class PushModule {}

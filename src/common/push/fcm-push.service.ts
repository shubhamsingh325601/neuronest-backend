import { Logger } from '@nestjs/common';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushMessage, PushService } from './push.service';

/** FCM answers with these when a token belongs to an app that was uninstalled or reinstalled. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** FCM allows at most 500 tokens in one multicast call. */
const BATCH_SIZE = 500;

/** Sends through Firebase Cloud Messaging and forgets tokens FCM says are dead. */
export class FcmPushService extends PushService {
  private readonly logger = new Logger(FcmPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    serviceAccount: ServiceAccount,
  ) {
    super();
    if (getApps().length === 0) {
      initializeApp({ credential: cert(serviceAccount) });
    }
  }

  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    try {
      if (userIds.length === 0) {
        return;
      }
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
      });
      for (let start = 0; start < devices.length; start += BATCH_SIZE) {
        await this.sendBatch(
          devices.slice(start, start + BATCH_SIZE).map((device) => device.token),
          message,
        );
      }
    } catch (err) {
      this.logger.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendBatch(tokens: string[], message: PushMessage): Promise<void> {
    const result = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high' },
    });
    const dead = tokens.filter((_, index) => {
      const code = result.responses[index]?.error?.code;
      return code !== undefined && DEAD_TOKEN_CODES.has(code);
    });
    if (dead.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }
  }
}

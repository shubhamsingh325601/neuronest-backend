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

/** A dry-run send to a made-up token: these answers prove the credentials and the FCM API work. */
const CREDENTIALS_OK_CODES = new Set([...DEAD_TOKEN_CODES, 'messaging/invalid-argument']);

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
    this.logger.log(
      `Firebase push is on (project ${serviceAccount.projectId ?? 'unknown'}); checking credentials`,
    );
    void this.verifyCredentials();
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
      if (devices.length === 0) {
        // The usual reason "no push arrived": the app never registered its token for this user.
        this.logger.log(
          { users: userIds.length, devices: 0, title: message.title },
          'push not sent: no registered devices',
        );
        return;
      }
      for (let start = 0; start < devices.length; start += BATCH_SIZE) {
        await this.sendBatch(
          devices.slice(start, start + BATCH_SIZE).map((device) => device.token),
          message,
          userIds.length,
        );
      }
    } catch (err) {
      this.logger.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendBatch(tokens: string[], message: PushMessage, users: number): Promise<void> {
    const result = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const dead = tokens.filter((_, index) => {
      const code = result.responses[index]?.error?.code;
      return code !== undefined && DEAD_TOKEN_CODES.has(code);
    });
    if (dead.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }

    // Counts and FCM error codes only: never the tokens, which are credentials for the phone.
    const failures: Record<string, number> = {};
    for (const response of result.responses) {
      const code = response.error?.code;
      if (code) failures[code] = (failures[code] ?? 0) + 1;
    }
    const summary = {
      users,
      devices: tokens.length,
      sent: result.successCount,
      failed: result.failureCount,
      pruned: dead.length,
      failures,
      title: message.title,
    };
    if (result.failureCount > dead.length) {
      this.logger.warn(summary, 'push sent with failures');
    } else {
      this.logger.log(summary, 'push sent');
    }
  }

  /** Dry-run send at boot, so wrong credentials or a disabled FCM API show up in the logs on deploy. */
  private async verifyCredentials(): Promise<void> {
    try {
      await getMessaging().send({ token: 'neuronest-startup-check', data: { check: '1' } }, true);
      this.logger.log('Firebase credentials verified');
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (CREDENTIALS_OK_CODES.has(code)) {
        this.logger.log('Firebase credentials verified');
        return;
      }
      this.logger.error(
        { code },
        `Firebase rejected the credentials, pushes will fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

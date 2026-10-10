import { Logger } from '@nestjs/common';
import { PushMessage, PushService } from './push.service';

/** Used when Firebase is not configured (local runs, tests): the send is logged and skipped. */
export class NoopPushService extends PushService {
  private readonly logger = new Logger(NoopPushService.name);

  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    this.logger.debug(
      `Push skipped (not configured): "${message.title}" for ${userIds.length} user(s).`,
    );
  }
}

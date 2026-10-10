import { PushService, type PushMessage } from '@common/push/push.service';

export interface SentPush {
  userIds: string[];
  message: PushMessage;
}

/** In-memory PushService used by e2e tests to read back what would have been pushed. */
export class FakePushService extends PushService {
  readonly sent: SentPush[] = [];

  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    this.sent.push({ userIds, message });
  }

  /** Pushes are fired after the response, so poll briefly until one with this title arrives. */
  async waitFor(title: string, timeoutMs = 2000): Promise<SentPush> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.sent.find((push) => push.message.title === title);
      if (found) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error(`No push titled "${title}" was sent.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  clear(): void {
    this.sent.length = 0;
  }
}

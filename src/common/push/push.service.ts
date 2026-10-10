export interface PushMessage {
  title: string;
  body: string;
  /** Extra values the app reads when the notification is opened. FCM only carries strings. */
  data?: Record<string, string>;
}

/**
 * Push-notification contract. Injected by this abstract class as the DI token; bound to
 * {@link FcmPushService} when Firebase credentials are configured and to {@link NoopPushService}
 * otherwise (see `push-provider.factory.ts`).
 */
export abstract class PushService {
  /**
   * Sends the message to every registered device of these users. Never throws: a failed push must not
   * fail the request that caused it.
   */
  abstract sendToUsers(userIds: string[], message: PushMessage): Promise<void>;
}

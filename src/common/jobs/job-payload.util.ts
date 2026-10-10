import type { JobContext } from './job-handler.registry';

/** Read the `userId` out of an email-job payload; a malformed payload is a permanent bug, so throw. */
export function payloadUserId(job: JobContext): string {
  const payload = job.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const userId = payload['userId'];
    if (typeof userId === 'string' && userId.length > 0) {
      return userId;
    }
  }
  throw new Error(`Job ${job.id} (${job.type}) has no userId in its payload`);
}

/** Optional frontend page the emailed link should open; absent means "use the default page". */
export function payloadCallbackUrl(job: JobContext): string | undefined {
  const payload = job.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const callbackUrl = payload['callbackUrl'];
    if (typeof callbackUrl === 'string' && callbackUrl.length > 0) {
      return callbackUrl;
    }
  }
  return undefined;
}

/** Current minute as an integer — the bucket that collapses double-click enqueues. */
export function minuteBucket(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 60_000);
}

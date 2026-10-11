import type { Prisma } from '@prisma/client';
import type { JobQueueService } from '@common/jobs/job-queue.service';

/** Generates the summary of a CLOSED conversation. Payload: `{ conversationId }` only. */
export const SUMMARISE_JOB = 'conversation.summarise';
/** Each attempt can spend provider quota. After the last one the job is DEAD and shows in the admin list. */
export const SUMMARISE_JOB_MAX_ATTEMPTS = 3;

/**
 * Called in the same transaction that closes a conversation: the summary row appears as PENDING and
 * the job row commits with it. Idempotent (`dedupeKey`); the caller kicks the queue after commit.
 */
export async function enqueueSummary(
  tx: Prisma.TransactionClient,
  queue: JobQueueService,
  conversation: { id: string; childId: string },
): Promise<void> {
  await tx.conversationSummary.createMany({
    data: [{ conversationId: conversation.id, childId: conversation.childId }],
    skipDuplicates: true,
  });
  await queue.enqueue(tx, {
    type: SUMMARISE_JOB,
    payload: { conversationId: conversation.id },
    dedupeKey: `summary:${conversation.id}`,
    maxAttempts: SUMMARISE_JOB_MAX_ATTEMPTS,
  });
}

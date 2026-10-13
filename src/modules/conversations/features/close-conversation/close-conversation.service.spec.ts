import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { JobQueueService } from '@common/jobs/job-queue.service';
import type { PrismaService } from '@common/prisma/prisma.service';
import type { ConversationEventBus } from '@modules/conversations/shared/conversation-event-bus';
import { CloseConversationService } from './close-conversation.service';

describe('CloseConversationService', () => {
  const tx = {
    conversation: { updateMany: jest.fn() },
    conversationSummary: { createMany: jest.fn() },
  };
  const prisma = {
    conversation: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const queue = { enqueue: jest.fn(), kick: jest.fn() };
  const bus = { publish: jest.fn(), subscribe: jest.fn() };
  const service = new CloseConversationService(
    prisma as unknown as PrismaService,
    queue as unknown as JobQueueService,
    bus as unknown as ConversationEventBus,
  );
  const parent = { id: 'parent-1', role: Role.PARENT, email: 'p@example.com' } as AuthenticatedUser;
  const row = {
    id: 'c-1',
    kind: 'HUMAN',
    topic: null,
    childId: 'child-1',
    parentId: 'parent-1',
    expertId: 'expert-1',
    status: 'CLOSED',
    lastMessageAt: null,
    closedAt: new Date(),
    messagesPurgedAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    prisma.conversation.findUnique.mockResolvedValue({ ...row, status: 'OPEN' });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue(row);
  });

  it('closes an open conversation, queues one summary job in the same transaction, then kicks the queue', async () => {
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });

    await service.close('c-1', parent);

    expect(tx.conversationSummary.createMany).toHaveBeenCalledWith({
      data: [{ conversationId: 'c-1', childId: 'child-1' }],
      skipDuplicates: true,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(tx, {
      type: 'conversation.summarise',
      payload: { conversationId: 'c-1' },
      dedupeKey: 'summary:c-1',
      maxAttempts: 3,
    });
    expect(queue.kick).toHaveBeenCalledTimes(1);
  });

  it('announces the close once on the event bus, with ids only, after the transaction', async () => {
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    let committed = false;
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => {
      const result = await fn(tx);
      committed = true;
      return result;
    });
    bus.publish.mockImplementation(() => expect(committed).toBe(true));

    await service.close('c-1', parent);

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledWith({
      type: 'conversation-closed',
      conversationId: 'c-1',
      kind: 'HUMAN',
      childId: 'child-1',
      parentId: 'parent-1',
      expertId: 'expert-1',
      reason: 'MANUAL',
    });
  });

  it('queues nothing when the conversation was already closed', async () => {
    tx.conversation.updateMany.mockResolvedValue({ count: 0 });

    await service.close('c-1', parent);

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.kick).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});

import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AI_CHAT_FOOTER } from '@modules/conversations/shared/ai-chat.constants';
import { CreateAiConversationService } from './create-ai-conversation.service';

const parent: AuthenticatedUser = {
  id: 'p1',
  email: 'p@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};

function make() {
  const row = {
    id: 'conv-1',
    kind: 'AI',
    topic: 'PLAN_EXPLAINER',
    childId: 'c1',
    status: 'OPEN',
    lastMessageAt: null,
    closedAt: null,
    messagesPurgedAt: null,
    createdAt: new Date(),
  };
  const tx = {
    conversation: {
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...row, lastMessageSeq: 1 }),
    },
    message: { create: jest.fn() },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ childId: 'c1', status: 'OPEN', lastMessageSeq: 0, offTopicCount: 0 }]),
  };
  const prisma = {
    conversation: tx.conversation,
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Meera Rao' }) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    assertCanChat: jest.fn().mockResolvedValue({
      id: 'c1',
      parentId: 'p1',
      name: 'Zephyrine Rao',
      preferredName: 'Zeph',
    }),
  };
  return {
    service: new CreateAiConversationService(prisma as never, access as never),
    prisma,
    access,
    tx,
  };
}

describe('CreateAiConversationService', () => {
  it('creates an AI conversation for the topic, owned by the child parent', async () => {
    const { service, tx, access } = make();

    const dto = await service.create('c1', { topic: 'PLAN_EXPLAINER' }, parent);

    expect(access.assertCanChat).toHaveBeenCalledWith('c1', parent);
    expect(tx.conversation.create).toHaveBeenCalledWith({
      data: { kind: 'AI', topic: 'PLAN_EXPLAINER', childId: 'c1', parentId: 'p1' },
    });
    expect(dto).toMatchObject({ id: 'conv-1', kind: 'AI', topic: 'PLAN_EXPLAINER' });
  });

  it('stores the fixed greeting as seq 1 in the same transaction: AI, COMPLETE, by name, no footer', async () => {
    const { service, tx, prisma } = make();

    await service.create('c1', { topic: 'PLAN_EXPLAINER' }, parent);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    const { data } = tx.message.create.mock.calls[0][0];
    expect(data).toMatchObject({
      conversationId: 'conv-1',
      seq: 1,
      sender: 'AI',
      state: 'COMPLETE',
    });
    expect(data.body).toContain('Hello Meera!');
    expect(data.body).toContain("Zeph's plan");
    expect(data.body).not.toContain(AI_CHAT_FOOTER);
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ lastMessageSeq: 1 }),
    });
  });

  it('422 AI_TOPIC_UNAVAILABLE for the assessment and AI_TOPIC_NOT_A_CHAT for a route', async () => {
    const { service, tx } = make();

    const unavailable = await service
      .create('c1', { topic: 'AI_ASSESSMENT' }, parent)
      .catch((e: unknown) => e);
    const route = await service
      .create('c1', { topic: 'BOOK_CALL' }, parent)
      .catch((e: unknown) => e);

    expect(unavailable).toBeInstanceOf(UnprocessableEntityException);
    expect((unavailable as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'AI_TOPIC_UNAVAILABLE',
    });
    expect((route as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'AI_TOPIC_NOT_A_CHAT',
    });
    expect(tx.conversation.create).not.toHaveBeenCalled();
  });

  it('creates nothing when the caller may not chat for this child', async () => {
    const { service, tx, access } = make();
    access.assertCanChat.mockRejectedValue(new ForbiddenException());

    await expect(service.create('c1', { topic: 'PLAN_EXPLAINER' }, parent)).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.conversation.create).not.toHaveBeenCalled();
  });
});

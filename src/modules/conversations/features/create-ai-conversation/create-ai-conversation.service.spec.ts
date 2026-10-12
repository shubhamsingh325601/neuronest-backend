import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
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
  const prisma = { conversation: { create: jest.fn().mockResolvedValue(row) } };
  const access = { assertCanChat: jest.fn().mockResolvedValue({ id: 'c1', parentId: 'p1' }) };
  return {
    service: new CreateAiConversationService(prisma as never, access as never),
    prisma,
    access,
  };
}

describe('CreateAiConversationService', () => {
  it('creates an AI conversation for the topic, owned by the child parent', async () => {
    const { service, prisma, access } = make();

    const dto = await service.create('c1', { topic: 'PLAN_EXPLAINER' }, parent);

    expect(access.assertCanChat).toHaveBeenCalledWith('c1', parent);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { kind: 'AI', topic: 'PLAN_EXPLAINER', childId: 'c1', parentId: 'p1' },
    });
    expect(dto).toMatchObject({ id: 'conv-1', kind: 'AI', topic: 'PLAN_EXPLAINER' });
  });

  it('422 AI_TOPIC_UNAVAILABLE for the assessment and AI_TOPIC_NOT_A_CHAT for a route', async () => {
    const { service, prisma } = make();

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
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates nothing when the caller may not chat for this child', async () => {
    const { service, prisma, access } = make();
    access.assertCanChat.mockRejectedValue(new ForbiddenException());

    await expect(service.create('c1', { topic: 'PLAN_EXPLAINER' }, parent)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});

import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationKind, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListMyConversationsService } from './list-my-conversations.service';

describe('ListMyConversationsService', () => {
  const prisma = { conversation: { findMany: jest.fn() } };
  let service: ListMyConversationsService;

  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const row = {
    id: 'c-1',
    kind: ConversationKind.HUMAN,
    topic: null,
    childId: 'ch-1',
    status: 'OPEN',
    lastMessageAt: new Date('2026-10-20T00:00:00Z'),
    closedAt: null,
    messagesPurgedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    child: { id: 'ch-1', name: 'Aarav' },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.conversation.findMany.mockResolvedValue([row]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListMyConversationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListMyConversationsService);
  });

  it('returns the expert chats, with the child name and no message text', async () => {
    const page = await service.list(as('ex-1', Role.EXPERT));

    const where = prisma.conversation.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ expertId: 'ex-1', kind: ConversationKind.HUMAN });
    expect(page.data[0]).toMatchObject({ id: 'c-1', child: { id: 'ch-1', name: 'Aarav' } });
    expect(page.data[0]).not.toHaveProperty('body');
  });

  it('refuses a parent, clinician and admin', async () => {
    await expect(service.list(as('pa-1', Role.PARENT))).rejects.toThrow(ForbiddenException);
    await expect(service.list(as('cl-1', Role.CLINICIAN))).rejects.toThrow(ForbiddenException);
    await expect(service.list(as('ad-1', Role.ADMIN))).rejects.toThrow(ForbiddenException);
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });
});

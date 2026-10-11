import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListConversationsService } from './list-conversations.service';

describe('ListConversationsService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
    conversation: { findMany: jest.fn() },
  };
  let service: ListConversationsService;
  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const row = {
    id: 'c-1',
    kind: 'HUMAN',
    topic: null,
    childId: 'child-1',
    status: 'CLOSED',
    lastMessageAt: null,
    closedAt: null,
    messagesPurgedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    summary: { status: 'READY' },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'pa-1' });
    prisma.conversation.findMany.mockResolvedValue([row]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListConversationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListConversationsService);
  });

  it('gives the parent every session of their child, with the summary status and no text', async () => {
    const page = await service.list('child-1', {}, as('pa-1', Role.PARENT));

    expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({ childId: 'child-1' });
    expect(page.data[0]).toMatchObject({ id: 'c-1', summaryStatus: 'READY' });
    expect(page.data[0]).not.toHaveProperty('summary');
    expect(page.nextCursor).toBeNull();
  });

  it('limits an assigned expert to the sessions they take part in', async () => {
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
    await service.list('child-1', {}, as('ex-1', Role.EXPERT));
    expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
      childId: 'child-1',
      expertId: 'ex-1',
    });
  });

  it('refuses an unassigned expert, another parent, a clinician and an admin', async () => {
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', {}, as('ex-2', Role.EXPERT))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.list('child-1', {}, as('pa-2', Role.PARENT))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.list('child-1', {}, as('cl-1', Role.CLINICIAN))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.list('child-1', {}, as('ad-1', Role.ADMIN))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });
});

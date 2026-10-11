import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';
import { ListConversationSummariesService } from './list-conversation-summaries.service';

describe('ListConversationSummariesService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    conversationSummary: { findMany: jest.fn() },
  };
  const service = new ListConversationSummariesService(prisma as unknown as PrismaService);
  const user = (role: Role, id = 'u-1'): AuthenticatedUser =>
    ({ id, role, email: 'x@example.com' }) as AuthenticatedUser;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
    prisma.conversationSummary.findMany.mockResolvedValue([]);
  });

  const whereOf = () => prisma.conversationSummary.findMany.mock.calls[0][0].where;

  it('lets the parent of the child, an assigned clinician and an admin see every summary', async () => {
    for (const caller of [user(Role.PARENT, 'parent-1'), user(Role.CLINICIAN), user(Role.ADMIN)]) {
      prisma.conversationSummary.findMany.mockClear();
      await service.list('child-1', {}, caller);
      expect(whereOf()).toEqual({ childId: 'child-1' });
    }
  });

  it('limits an assigned expert to the conversations they took part in', async () => {
    await service.list('child-1', {}, user(Role.EXPERT, 'expert-1'));
    expect(whereOf()).toEqual({ childId: 'child-1', conversation: { expertId: 'expert-1' } });
  });

  it('refuses another parent, an unassigned clinician and an unassigned expert', async () => {
    await expect(service.list('child-1', {}, user(Role.PARENT, 'other'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', {}, user(Role.CLINICIAN))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.list('child-1', {}, user(Role.EXPERT))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationSummary.findMany).not.toHaveBeenCalled();
  });

  it('refuses a role it does not know (default-deny)', async () => {
    await expect(service.list('child-1', {}, user('SOMETHING_NEW' as Role))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.child.findUnique).not.toHaveBeenCalled();
  });

  it('pages newest first with a cursor', async () => {
    const row = (id: string) => ({
      id,
      conversationId: `c-${id}`,
      childId: 'child-1',
      status: 'PENDING',
      content: null,
      generatedAt: null,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      conversation: { kind: 'HUMAN', closedAt: null, messagesPurgedAt: null },
    });
    prisma.conversationSummary.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);

    const page = await service.list('child-1', { limit: 2 }, user(Role.ADMIN));

    expect(prisma.conversationSummary.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    expect(page.data.map((s) => s.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).not.toBeNull();
  });
});

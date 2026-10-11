import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';
import { loadParticipantConversation } from './load-participant-conversation';

describe('loadParticipantConversation', () => {
  const prisma = {
    conversation: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
  };
  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const conversation = { id: 'c-1', childId: 'child-1', parentId: 'pa-1', expertId: 'ex-1' };
  const load = (caller: AuthenticatedUser) =>
    loadParticipantConversation(prisma as unknown as PrismaService, 'c-1', caller);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.conversation.findUnique.mockResolvedValue(conversation);
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
  });

  it('404s for an unknown conversation', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(load(as('pa-1', Role.PARENT))).rejects.toThrow(NotFoundException);
  });

  it('lets the conversation parent and its assigned expert in', async () => {
    await expect(load(as('pa-1', Role.PARENT))).resolves.toBe(conversation);
    await expect(load(as('ex-1', Role.EXPERT))).resolves.toBe(conversation);
  });

  it('refuses an expert whose assignment to the child was removed', async () => {
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null);
    await expect(load(as('ex-1', Role.EXPERT))).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['another parent', as('pa-2', Role.PARENT)],
    ['another expert', as('ex-2', Role.EXPERT)],
    ['an admin', as('ad-1', Role.ADMIN)],
    ['a clinician', as('cl-1', Role.CLINICIAN)],
  ])('refuses %s', async (_name, caller) => {
    await expect(load(caller)).rejects.toThrow(ForbiddenException);
  });
});

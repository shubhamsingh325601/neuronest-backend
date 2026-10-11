import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateConversationService } from './create-conversation.service';

describe('CreateConversationService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    expertChildAssignment: { findFirst: jest.fn() },
    conversation: { create: jest.fn() },
  };
  let service: CreateConversationService;
  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'pa-1' });
    prisma.expertChildAssignment.findFirst.mockResolvedValue({ expertId: 'ex-1' });
    prisma.conversation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'c-1', status: 'OPEN', topic: null, ...data }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [CreateConversationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CreateConversationService);
  });

  it('starts a HUMAN session with the first active assigned expert', async () => {
    await expect(service.create('child-1', as('pa-1', Role.PARENT))).resolves.toMatchObject({
      id: 'c-1',
      kind: 'HUMAN',
      childId: 'child-1',
    });
    expect(prisma.expertChildAssignment.findFirst).toHaveBeenCalledWith({
      where: { childId: 'child-1', expert: { status: UserStatus.ACTIVE } },
      orderBy: { createdAt: 'asc' },
      select: { expertId: true },
    });
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { kind: 'HUMAN', childId: 'child-1', parentId: 'pa-1', expertId: 'ex-1' },
    });
  });

  it('409s NO_EXPERT_ASSIGNED when the child has no active expert', async () => {
    prisma.expertChildAssignment.findFirst.mockResolvedValue(null);
    const err = await service.create('child-1', as('pa-1', Role.PARENT)).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'NO_EXPERT_ASSIGNED' });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('refuses another parent, an expert and an admin', async () => {
    for (const caller of [
      as('pa-2', Role.PARENT),
      as('ex-1', Role.EXPERT),
      as('ad-1', Role.ADMIN),
    ]) {
      await expect(service.create('child-1', caller)).rejects.toThrow(ForbiddenException);
    }
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});

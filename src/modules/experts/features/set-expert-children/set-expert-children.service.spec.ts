import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { SetExpertChildrenService } from './set-expert-children.service';

describe('SetExpertChildrenService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    child: { count: jest.fn() },
    expertChildAssignment: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: SetExpertChildrenService;
  const row = (childId: string) => ({ id: `a-${childId}`, expertId: 'ex-1', childId, createdAt: new Date() });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    prisma.user.findFirst.mockResolvedValue({ status: UserStatus.ACTIVE });
    const moduleRef = await Test.createTestingModule({
      providers: [SetExpertChildrenService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SetExpertChildrenService);
  });

  it('replaces the set: removes the unlisted, adds the new, in one transaction', async () => {
    prisma.child.count.mockResolvedValue(2);
    prisma.expertChildAssignment.findMany.mockResolvedValue([row('c1'), row('c2')]);

    const res = await service.set('ex-1', { childIds: ['c1', 'c2'] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.expertChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { expertId: 'ex-1', childId: { notIn: ['c1', 'c2'] } },
    });
    expect(prisma.expertChildAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { expertId: 'ex-1', childId: 'c1' },
        { expertId: 'ex-1', childId: 'c2' },
      ],
      skipDuplicates: true,
    });
    expect(res.map((r) => r.childId)).toEqual(['c1', 'c2']);
  });

  it('404s EXPERT_NOT_FOUND for a user that is not an expert', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.set('x', { childIds: [] })).rejects.toThrow(NotFoundException);
  });

  it('404s CHILD_NOT_FOUND when any child is missing and changes nothing', async () => {
    prisma.child.count.mockResolvedValue(1);
    await expect(service.set('ex-1', { childIds: ['c1', 'c2'] })).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('409s EXPERT_NOT_ACTIVE when assigning to a suspended expert, but still lets it be cleared', async () => {
    prisma.user.findFirst.mockResolvedValue({ status: UserStatus.SUSPENDED });
    await expect(service.set('ex-1', { childIds: ['c1'] })).rejects.toThrow(ConflictException);

    prisma.expertChildAssignment.findMany.mockResolvedValue([]);
    await expect(service.set('ex-1', { childIds: [] })).resolves.toEqual([]);
    expect(prisma.expertChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { expertId: 'ex-1', childId: { notIn: [] } },
    });
  });
});

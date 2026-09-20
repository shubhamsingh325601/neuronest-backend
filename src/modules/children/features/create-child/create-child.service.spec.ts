import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateChildService } from './create-child.service';

describe('CreateChildService', () => {
  const prisma = { child: { findUnique: jest.fn(), create: jest.fn() } };
  let service: CreateChildService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CreateChildService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CreateChildService);
  });

  it('creates a trimmed child for a parent with none yet', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    prisma.child.create.mockResolvedValue({
      id: 'child-1',
      parentId: 'parent-1',
      name: 'Alex',
      dateOfBirth: new Date('2019-05-14'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('parent-1', {
      name: '  Alex  ',
      dateOfBirth: '2019-05-14',
    });

    expect(prisma.child.findUnique).toHaveBeenCalledWith({
      where: { parentId: 'parent-1' },
      select: { id: true },
    });
    expect(prisma.child.create).toHaveBeenCalledWith({
      data: { parentId: 'parent-1', name: 'Alex', dateOfBirth: new Date('2019-05-14') },
    });
    expect(result.id).toBe('child-1');
  });

  it('409s when the parent already has a child', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'existing-child' });

    await expect(
      service.create('parent-1', { name: 'Alex', dateOfBirth: '2019-05-14' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.child.create).not.toHaveBeenCalled();
  });
});

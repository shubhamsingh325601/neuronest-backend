import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListUsersService } from './list-users.service';

describe('ListUsersService', () => {
  const prisma = { user: { findMany: jest.fn() } };
  let service: ListUsersService;

  const userRow = {
    id: 'u1',
    name: 'Jordan',
    email: 'jordan@example.com',
    role: Role.PARENT,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListUsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListUsersService);
  });

  it('returns a page with no filters', async () => {
    prisma.user.findMany.mockResolvedValue([userRow]);
    const result = await service.list({});
    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('applies ?role= and ?status= filters together', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.list({ role: Role.CLINICIAN, status: UserStatus.SUSPENDED });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: Role.CLINICIAN, status: UserStatus.SUSPENDED },
      }),
    );
  });

  it('derives nextCursor when a page overflows the limit', async () => {
    prisma.user.findMany.mockResolvedValue([
      { ...userRow, id: 'u1' },
      { ...userRow, id: 'u2' },
    ]);
    const result = await service.list({ limit: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
  });
});

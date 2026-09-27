import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { encodeCursor } from '@common/pagination/cursor.util';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListChildrenService } from './list-children.service';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const CALLER_ID = '33333333-3333-3333-3333-333333333333';

const row = (id: string) => ({
  id,
  parentId: UUID_A,
  name: 'Alex',
  dateOfBirth: new Date('2018-01-01'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

const caller = (role: Role): AuthenticatedUser => ({
  id: CALLER_ID,
  email: 'caller@example.com',
  role,
  status: 'ACTIVE' as never,
});

describe('ListChildrenService', () => {
  const prisma = { child: { findMany: jest.fn() } };
  let service: ListChildrenService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListChildrenService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListChildrenService);
  });

  it('filters to own child for PARENT', async () => {
    prisma.child.findMany.mockResolvedValue([row(UUID_A)]);

    const res = await service.list({}, caller(Role.PARENT));

    expect(prisma.child.findMany).toHaveBeenCalledWith({
      where: { parentId: CALLER_ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(res.data).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it('filters to the assigned caseload for CLINICIAN', async () => {
    prisma.child.findMany.mockResolvedValue([]);

    await service.list({}, caller(Role.CLINICIAN));

    expect(prisma.child.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicianAssignments: { some: { clinicianId: CALLER_ID } } },
      }),
    );
  });

  it('applies no filter for ADMIN', async () => {
    prisma.child.findMany.mockResolvedValue([]);

    await service.list({}, caller(Role.ADMIN));

    expect(prisma.child.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('over-fetches by one and returns a nextCursor when there is another page', async () => {
    prisma.child.findMany.mockResolvedValue([row(UUID_A), row(UUID_B)]);

    const res = await service.list({ limit: 1 }, caller(Role.ADMIN));

    expect(prisma.child.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(res.data.map((r) => r.id)).toEqual([UUID_A]);
    expect(res.nextCursor).toBe(encodeCursor(UUID_A));
  });

  it('decodes the cursor and skips the anchor row', async () => {
    prisma.child.findMany.mockResolvedValue([]);

    await service.list({ cursor: encodeCursor(UUID_A) }, caller(Role.ADMIN));

    expect(prisma.child.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: UUID_A }, skip: 1 }),
    );
  });
});

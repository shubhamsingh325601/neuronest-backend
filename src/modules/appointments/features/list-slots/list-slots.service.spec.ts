import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { encodeCursor } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListSlotsService } from './list-slots.service';

describe('ListSlotsService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    appointmentSlot: { findMany: jest.fn() },
  };
  let service: ListSlotsService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const slotRow = (id: string) => ({
    id,
    startsAt: new Date('2026-12-01T09:00:00Z'),
    endsAt: new Date('2026-12-01T09:30:00Z'),
    createdAt: new Date('2026-10-05T00:00:00Z'),
    clinician: { id: 'clin-1', name: 'Dr Clin' },
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a-1' });
    prisma.appointmentSlot.findMany.mockResolvedValue([slotRow('s-1')]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListSlotsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListSlotsService);
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('x', asUser('parent-1', Role.PARENT), {})).rejects.toMatchObject({
      response: { code: 'CHILD_NOT_FOUND' },
    });
  });

  it('403s for another parent and for an unassigned clinician', async () => {
    await expect(
      service.list('child-1', asUser('parent-2', Role.PARENT), {}),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('child-1', asUser('clin-9', Role.CLINICIAN), {}),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(prisma.appointmentSlot.findMany).not.toHaveBeenCalled();
  });

  it('filters to future, unbooked slots of ACTIVE clinicians assigned to the child', async () => {
    const out = await service.list('child-1', asUser('parent-1', Role.PARENT), {});
    const args = prisma.appointmentSlot.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      appointment: null,
      clinician: { status: UserStatus.ACTIVE, clinicianAssignments: { some: { childId: 'child-1' } } },
    });
    expect(args.where.startsAt.gt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual([{ startsAt: 'asc' }, { id: 'asc' }]);
    expect(out.data[0]).toMatchObject({
      id: 's-1',
      clinician: { id: 'clin-1', name: 'Dr Clin' },
      startsAt: '2026-12-01T09:00:00.000Z',
    });
    expect(out.nextCursor).toBeNull();
  });

  it('lets an admin and an assigned clinician through, and paginates with a cursor', async () => {
    const rows = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'].map(
      slotRow,
    );
    prisma.appointmentSlot.findMany.mockResolvedValue(rows);
    const out = await service.list('child-1', asUser('admin-1', Role.ADMIN), { limit: 1 });
    expect(out.data).toHaveLength(1);
    expect(out.nextCursor).toBe(encodeCursor('00000000-0000-4000-8000-000000000001'));
    await expect(
      service.list('child-1', asUser('clin-1', Role.CLINICIAN), {
        cursor: out.nextCursor ?? undefined,
      }),
    ).resolves.toBeDefined();
    expect(prisma.appointmentSlot.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: '00000000-0000-4000-8000-000000000001' },
      skip: 1,
    });
  });
});

import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListChildAppointmentsService } from './list-child-appointments.service';

describe('ListChildAppointmentsService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    appointment: { findMany: jest.fn() },
  };
  let service: ListChildAppointmentsService;
  const now = new Date('2026-10-05T12:00:00Z');
  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const row = {
    id: 'a-1',
    childId: 'child-1',
    createdAt: now,
    slot: {
      id: 's-1',
      startsAt: new Date('2026-11-01T09:00:00Z'),
      endsAt: new Date('2026-11-01T09:30:00Z'),
      clinician: { id: 'clin-1', name: 'Dr Clin' },
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'x' });
    prisma.appointment.findMany.mockResolvedValue([row]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListChildAppointmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListChildAppointmentsService);
  });

  it('returns the child appointments with the clinician name', async () => {
    const out = await service.list('child-1', asUser('parent-1', Role.PARENT), {}, now);
    expect(out.data[0]).toMatchObject({ id: 'a-1', clinician: { name: 'Dr Clin' } });
    expect(out.nextCursor).toBeNull();
  });

  it('403s another parent and an unassigned clinician; 404s an unknown child', async () => {
    await expect(
      service.list('child-1', asUser('parent-2', Role.PARENT), {}, now),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('child-1', asUser('clin-9', Role.CLINICIAN), {}, now),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('x', asUser('admin-1', Role.ADMIN), {}, now)).rejects.toMatchObject({
      response: { code: 'CHILD_NOT_FOUND' },
    });
  });

  it.each([
    ['upcoming', { slot: { endsAt: { gt: now } }, childId: 'child-1' }, 'asc'],
    ['past', { slot: { endsAt: { lte: now } }, childId: 'child-1' }, 'desc'],
  ] as const)('?when=%s filters on slot end and orders accordingly', async (when, where, dir) => {
    await service.list('child-1', asUser('admin-1', Role.ADMIN), { when }, now);
    const args = prisma.appointment.findMany.mock.calls[0][0];
    expect(args.where).toEqual(where);
    expect(args.orderBy).toEqual([{ slot: { startsAt: dir } }, { id: dir }]);
  });
});

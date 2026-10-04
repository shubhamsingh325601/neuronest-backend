import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListAppointmentsService } from './list-appointments.service';

describe('ListAppointmentsService', () => {
  const prisma = { appointment: { findMany: jest.fn() } };
  let service: ListAppointmentsService;
  const now = new Date('2026-10-05T12:00:00Z');
  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointment.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListAppointmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListAppointmentsService);
  });

  const scopeOf = () => prisma.appointment.findMany.mock.calls[0][0].where.AND[0];

  it('a clinician is filtered to appointments on their own slots', async () => {
    await service.list(asUser('clin-1', Role.CLINICIAN), {}, now);
    expect(scopeOf()).toEqual({ slot: { clinicianId: 'clin-1' } });
  });

  it("a parent is filtered to their own child's appointments", async () => {
    await service.list(asUser('parent-1', Role.PARENT), {}, now);
    expect(scopeOf()).toEqual({ child: { parentId: 'parent-1' } });
  });

  it('an admin is unfiltered; ?when and the cursor are passed through', async () => {
    await service.list(
      asUser('admin-1', Role.ADMIN),
      { when: 'upcoming', limit: 5, cursor: Buffer.from('00000000-0000-4000-8000-000000000001').toString('base64url') },
      now,
    );
    const args = prisma.appointment.findMany.mock.calls[0][0];
    expect(scopeOf()).toEqual({});
    expect(args.where.AND[1]).toEqual({ slot: { endsAt: { gt: now } } });
    expect(args.take).toBe(6);
    expect(args.cursor).toEqual({ id: '00000000-0000-4000-8000-000000000001' });
  });
});

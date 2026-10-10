import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListOwnSlotsService } from './list-own-slots.service';

describe('ListOwnSlotsService', () => {
  const prisma = { appointmentSlot: { findMany: jest.fn() } };
  let service: ListOwnSlotsService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const row = (id: string, booked: boolean) => ({
    id,
    startsAt: new Date('2026-12-01T09:00:00Z'),
    endsAt: new Date('2026-12-01T09:30:00Z'),
    meetingUrl: 'https://meet.example.com/x',
    createdAt: new Date('2026-10-05T00:00:00Z'),
    appointment: booked ? { id: 'a-1' } : null,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointmentSlot.findMany.mockResolvedValue([row('s-1', true), row('s-2', false)]);
    const moduleRef = await Test.createTestingModule({
      providers: [ListOwnSlotsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListOwnSlotsService);
  });

  it('limits a clinician to their own slots that have not ended and flags the booked ones', async () => {
    const out = await service.list(asUser('clin-1', Role.CLINICIAN), {});
    const args = prisma.appointmentSlot.findMany.mock.calls[0][0];
    expect(args.where.clinicianId).toBe('clin-1');
    expect(args.where.endsAt.gt).toBeInstanceOf(Date);
    expect(out.data.map((s) => s.booked)).toEqual([true, false]);
    expect(out.data[0].meetingUrl).toBe('https://meet.example.com/x');
    expect(out.nextCursor).toBeNull();
  });

  it('ignores a clinicianId filter from a clinician', async () => {
    await service.list(asUser('clin-1', Role.CLINICIAN), { clinicianId: 'clin-2' });
    expect(prisma.appointmentSlot.findMany.mock.calls[0][0].where.clinicianId).toBe('clin-1');
  });

  it('lets an admin see everyone, or one clinician with clinicianId', async () => {
    await service.list(asUser('admin-1', Role.ADMIN), {});
    expect(prisma.appointmentSlot.findMany.mock.calls[0][0].where.clinicianId).toBeUndefined();
    await service.list(asUser('admin-1', Role.ADMIN), { clinicianId: 'clin-2' });
    expect(prisma.appointmentSlot.findMany.mock.calls[1][0].where.clinicianId).toBe('clin-2');
  });
});

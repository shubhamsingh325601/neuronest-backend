import { Test } from '@nestjs/testing';
import { Prisma, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotifier } from '@common/push/push-notifier';
import { CreateAppointmentService } from './create-appointment.service';

describe('CreateAppointmentService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    appointment: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    child: { findUnique: jest.fn() },
    appointmentSlot: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const notifier = { toClinicians: jest.fn(), toParent: jest.fn() };
  let service: CreateAppointmentService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const parent = asUser('parent-1', Role.PARENT);
  const now = new Date('2026-10-05T12:00:00Z');
  const dto = { slotId: 'slot-1' };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.appointmentSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    tx.appointment.findUnique.mockResolvedValue(null);
    tx.appointment.findFirst.mockResolvedValue(null);
    tx.appointment.create.mockResolvedValue({
      id: 'appt-1',
      childId: 'child-1',
      createdAt: now,
      slot: {
        id: 'slot-1',
        startsAt: new Date('2026-11-01T09:00:00Z'),
        endsAt: new Date('2026-11-01T09:30:00Z'),
        clinician: { id: 'clin-1', name: 'Dr Clin' },
      },
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateAppointmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushNotifier, useValue: notifier },
      ],
    }).compile();
    service = moduleRef.get(CreateAppointmentService);
  });

  it('tells the care team about the booking', async () => {
    await service.create('child-1', parent, dto, now);
    expect(notifier.toClinicians).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ title: 'New call booked' }),
    );
  });

  it('books the slot and embeds the clinician name', async () => {
    const out = await service.create('child-1', parent, dto, now);
    expect(out).toMatchObject({
      id: 'appt-1',
      childId: 'child-1',
      slotId: 'slot-1',
      clinician: { id: 'clin-1', name: 'Dr Clin' },
      startsAt: '2026-11-01T09:00:00.000Z',
    });
    expect(tx.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { slotId: 'slot-1', childId: 'child-1', bookedById: 'parent-1' },
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled(); // child row locked
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.create('x', parent, dto, now)).rejects.toMatchObject({
      response: { code: 'CHILD_NOT_FOUND' },
    });
  });

  it('403s for another parent, a clinician and an admin (booking is own-parent only)', async () => {
    for (const caller of [
      asUser('parent-2', Role.PARENT),
      asUser('clin-1', Role.CLINICIAN),
      asUser('admin-1', Role.ADMIN),
    ]) {
      await expect(service.create('child-1', caller, dto, now)).rejects.toMatchObject({
        response: { code: 'FORBIDDEN' },
      });
    }
    expect(prisma.appointmentSlot.findFirst).not.toHaveBeenCalled();
  });

  it('404s SLOT_NOT_FOUND when the slot is missing, past, or its clinician is unassigned/inactive', async () => {
    prisma.appointmentSlot.findFirst.mockResolvedValue(null);
    await expect(service.create('child-1', parent, dto, now)).rejects.toMatchObject({
      response: { code: 'SLOT_NOT_FOUND' },
    });
    const where = prisma.appointmentSlot.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: 'slot-1',
      startsAt: { gt: now },
      clinician: {
        status: UserStatus.ACTIVE,
        clinicianAssignments: { some: { childId: 'child-1' } },
      },
    });
  });

  it('409s SLOT_ALREADY_BOOKED when the slot already has an appointment', async () => {
    tx.appointment.findUnique.mockResolvedValue({ id: 'other' });
    await expect(service.create('child-1', parent, dto, now)).rejects.toMatchObject({
      response: { code: 'SLOT_ALREADY_BOOKED' },
    });
  });

  it('409s APPOINTMENT_ALREADY_UPCOMING when the child has an unfinished appointment', async () => {
    tx.appointment.findFirst.mockResolvedValue({ id: 'mine' });
    await expect(service.create('child-1', parent, dto, now)).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_ALREADY_UPCOMING' },
    });
    expect(tx.appointment.findFirst.mock.calls[0][0].where).toEqual({
      childId: 'child-1',
      slot: { endsAt: { gt: now } },
    });
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it('maps the unique-slotId race (P2002) to 409 SLOT_ALREADY_BOOKED', async () => {
    tx.appointment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.create('child-1', parent, dto, now)).rejects.toMatchObject({
      response: { code: 'SLOT_ALREADY_BOOKED' },
    });
  });
});

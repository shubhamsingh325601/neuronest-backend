import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { CancelAppointmentService } from './cancel-appointment.service';

describe('CancelAppointmentService', () => {
  const prisma = { appointment: { findUnique: jest.fn(), deleteMany: jest.fn() } };
  let service: CancelAppointmentService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const now = new Date('2026-10-05T12:00:00Z');
  const upcoming = {
    id: 'appt-1',
    child: { parentId: 'parent-1' },
    slot: { startsAt: new Date('2026-10-06T09:00:00Z') },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointment.findUnique.mockResolvedValue(upcoming);
    prisma.appointment.deleteMany.mockResolvedValue({ count: 1 });
    const moduleRef = await Test.createTestingModule({
      providers: [CancelAppointmentService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CancelAppointmentService);
  });

  it('deletes the booking of the parent who owns the child', async () => {
    await service.cancel('appt-1', asUser('parent-1', Role.PARENT), now);
    expect(prisma.appointment.deleteMany).toHaveBeenCalledWith({ where: { id: 'appt-1' } });
  });

  it('404s an unknown appointment', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);
    await expect(
      service.cancel('nope', asUser('parent-1', Role.PARENT), now),
    ).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_NOT_FOUND' },
    });
  });

  it.each([
    ['another parent', asUser('parent-2', Role.PARENT)],
    ['the assigned clinician', asUser('clin-1', Role.CLINICIAN)],
    ['an admin', asUser('admin-1', Role.ADMIN)],
  ])('forbids %s', async (_label, caller) => {
    await expect(service.cancel('appt-1', caller, now)).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
    expect(prisma.appointment.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses once the call has started', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...upcoming,
      slot: { startsAt: new Date('2026-10-05T11:00:00Z') },
    });
    await expect(
      service.cancel('appt-1', asUser('parent-1', Role.PARENT), now),
    ).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_STARTED' },
    });
    expect(prisma.appointment.deleteMany).not.toHaveBeenCalled();
  });
});

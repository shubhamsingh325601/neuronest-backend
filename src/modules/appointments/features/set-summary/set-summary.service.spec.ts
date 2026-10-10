import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotifier } from '@common/push/push-notifier';
import { SetSummaryService } from './set-summary.service';

describe('SetSummaryService', () => {
  const prisma = {
    appointment: { findUnique: jest.fn(), update: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
  };
  const notifier = { toClinicians: jest.fn(), toParent: jest.fn() };
  let service: SetSummaryService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const now = new Date('2026-10-05T12:00:00Z');
  const started = {
    id: 'appt-1',
    childId: 'child-1',
    slot: { startsAt: new Date('2026-10-05T11:30:00Z') },
  };
  const body = { summary: '  Good progress.  ', actionPoints: [' Use the timer '] };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointment.findUnique.mockResolvedValue(started);
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.appointment.update.mockResolvedValue({
      id: 'appt-1',
      childId: 'child-1',
      createdAt: now,
      prepTopicIds: [],
      prepChecklistIds: [],
      summary: 'Good progress.',
      actionPoints: ['Use the timer'],
      slot: {
        id: 'slot-1',
        startsAt: started.slot.startsAt,
        endsAt: new Date('2026-10-05T12:00:00Z'),
        meetingUrl: null,
        clinician: { id: 'clin-1', name: 'Dr Clin' },
      },
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SetSummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushNotifier, useValue: notifier },
      ],
    }).compile();
    service = moduleRef.get(SetSummaryService);
  });

  it('tells the parent the summary is ready', async () => {
    await service.set('appt-1', asUser('clin-1', Role.CLINICIAN), body, now);
    expect(notifier.toParent).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ title: 'Call summary ready' }),
    );
  });

  it('lets the assigned clinician record a trimmed summary', async () => {
    const dto = await service.set('appt-1', asUser('clin-1', Role.CLINICIAN), body, now);
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { summary: 'Good progress.', actionPoints: ['Use the timer'] },
      }),
    );
    expect(dto.summary).toBe('Good progress.');
  });

  it('lets an admin record one without an assignment check', async () => {
    await service.set('appt-1', asUser('admin-1', Role.ADMIN), body, now);
    expect(prisma.clinicianChildAssignment.findUnique).not.toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalled();
  });

  it('forbids an unassigned clinician', async () => {
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.set('appt-1', asUser('clin-2', Role.CLINICIAN), body, now),
    ).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
  });

  it('404s an unknown appointment', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);
    await expect(
      service.set('nope', asUser('clin-1', Role.CLINICIAN), body, now),
    ).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_NOT_FOUND' },
    });
  });

  it('refuses before the call has started', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...started,
      slot: { startsAt: new Date('2026-10-06T09:00:00Z') },
    });
    await expect(
      service.set('appt-1', asUser('clin-1', Role.CLINICIAN), body, now),
    ).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_NOT_STARTED' },
    });
  });
});

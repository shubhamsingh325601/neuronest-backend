import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { SavePreparationService } from './save-preparation.service';

describe('SavePreparationService', () => {
  const prisma = { appointment: { findUnique: jest.fn(), update: jest.fn() } };
  let service: SavePreparationService;

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
    slot: { endsAt: new Date('2026-10-06T09:30:00Z') },
  };
  const body = { topicIds: ['g1', 'g1', 'g2'], checklistIds: ['prep_1'] };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointment.findUnique.mockResolvedValue(upcoming);
    prisma.appointment.update.mockResolvedValue({
      id: 'appt-1',
      childId: 'child-1',
      createdAt: now,
      prepTopicIds: ['g1', 'g2'],
      prepChecklistIds: ['prep_1'],
      summary: null,
      actionPoints: [],
      slot: {
        id: 'slot-1',
        startsAt: new Date('2026-10-06T09:00:00Z'),
        endsAt: new Date('2026-10-06T09:30:00Z'),
        meetingUrl: null,
        clinician: { id: 'clin-1', name: 'Dr Clin' },
      },
    });
    const moduleRef = await Test.createTestingModule({
      providers: [SavePreparationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SavePreparationService);
  });

  it('saves the de-duplicated selections for the child’s own parent', async () => {
    const dto = await service.save('appt-1', asUser('parent-1', Role.PARENT), body, now);
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: { prepTopicIds: ['g1', 'g2'], prepChecklistIds: ['prep_1'] },
      }),
    );
    expect(dto.prepTopicIds).toEqual(['g1', 'g2']);
  });

  it('404s an unknown appointment', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);
    await expect(service.save('nope', asUser('parent-1', Role.PARENT), body, now)).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_NOT_FOUND' },
    });
  });

  it.each([
    ['another parent', asUser('parent-2', Role.PARENT)],
    ['the clinician', asUser('clin-1', Role.CLINICIAN)],
    ['an admin', asUser('admin-1', Role.ADMIN)],
  ])('forbids %s', async (_label, caller) => {
    await expect(service.save('appt-1', caller, body, now)).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('refuses once the call has ended', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...upcoming,
      slot: { endsAt: new Date('2026-10-05T11:00:00Z') },
    });
    await expect(service.save('appt-1', asUser('parent-1', Role.PARENT), body, now)).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_ENDED' },
    });
  });
});
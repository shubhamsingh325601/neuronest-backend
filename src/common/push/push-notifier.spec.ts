import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotifier } from './push-notifier';
import { PushService } from './push.service';

describe('PushNotifier', () => {
  const prisma = {
    clinicianChildAssignment: { findMany: jest.fn() },
    child: { findUnique: jest.fn() },
    userPreference: { findUnique: jest.fn() },
  };
  const push = { sendToUsers: jest.fn() };
  const message = { title: 'Hello', body: 'World' };
  let notifier: PushNotifier;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushNotifier,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    notifier = moduleRef.get(PushNotifier);
  });

  it('sends to every active clinician assigned to the child', async () => {
    prisma.clinicianChildAssignment.findMany.mockResolvedValue([
      { clinicianId: 'clin-1' },
      { clinicianId: 'clin-2' },
    ]);
    await notifier.toClinicians('child-1', message);
    expect(prisma.clinicianChildAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { childId: 'child-1', clinician: { status: 'ACTIVE' } } }),
    );
    expect(push.sendToUsers).toHaveBeenCalledWith(['clin-1', 'clin-2'], message);
  });

  it('sends to the parent when they have not changed their choices', async () => {
    prisma.child.findUnique.mockResolvedValue({ parentId: 'parent-1' });
    prisma.userPreference.findUnique.mockResolvedValue(null);
    await notifier.toParent('child-1', message);
    expect(push.sendToUsers).toHaveBeenCalledWith(['parent-1'], message);
  });

  it('stays quiet for a parent who switched these updates off', async () => {
    prisma.child.findUnique.mockResolvedValue({ parentId: 'parent-1' });
    prisma.userPreference.findUnique.mockResolvedValue({ appointmentReminders: false });
    await notifier.toParent('child-1', message);
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it('does nothing for a child that does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await notifier.toParent('missing', message);
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it('never throws, even when the lookup or the send fails', async () => {
    prisma.clinicianChildAssignment.findMany.mockRejectedValue(new Error('db down'));
    await expect(notifier.toClinicians('child-1', message)).resolves.toBeUndefined();

    prisma.child.findUnique.mockResolvedValue({ parentId: 'parent-1' });
    prisma.userPreference.findUnique.mockResolvedValue(null);
    push.sendToUsers.mockRejectedValue(new Error('fcm down'));
    await expect(notifier.toParent('child-1', message)).resolves.toBeUndefined();
  });
});

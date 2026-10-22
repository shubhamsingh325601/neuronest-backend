import { Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { getApps } from 'firebase-admin/app';
import { FcmPushService } from './fcm-push.service';

const sendEachForMulticast = jest.fn();
const send = jest.fn();
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn((account: unknown) => account),
  getApps: jest.fn(() => [{}]),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast, send }),
}));

describe('FcmPushService', () => {
  const prisma = {
    deviceToken: { findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const message = { title: 'Hello', body: 'World' };
  let service: FcmPushService;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    (getApps as jest.Mock).mockReturnValue([{}]);
    send.mockRejectedValue({ code: 'messaging/invalid-argument' });
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new FcmPushService(prisma as unknown as PrismaService, {
      projectId: 'demo',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends to every device of the users and logs counts, never tokens', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-1' }, { token: 'tok-2' }]);
    sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });
    await service.sendToUsers(['u1'], message);
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['tok-1', 'tok-2'] }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ devices: 2, sent: 2, failed: 0, pruned: 0 }),
      'push sent',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('tok-1');
  });

  it('forgets dead tokens and warns about other failures', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([{ token: 'dead' }, { token: 'quota' }]);
    sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/quota-exceeded' } },
      ],
    });
    await service.sendToUsers(['u1'], message);
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['dead'] } },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        pruned: 1,
        failures: {
          'messaging/registration-token-not-registered': 1,
          'messaging/quota-exceeded': 1,
        },
      }),
      'push sent with failures',
    );
  });

  it('says why nothing was sent when the users have no registered device', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([]);
    await service.sendToUsers(['u1'], message);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ devices: 0 }),
      'push not sent: no registered devices',
    );
  });

  it('never throws when Firebase fails', async () => {
    prisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-1' }]);
    sendEachForMulticast.mockRejectedValue(new Error('fcm down'));
    await expect(service.sendToUsers(['u1'], message)).resolves.toBeUndefined();
  });
});

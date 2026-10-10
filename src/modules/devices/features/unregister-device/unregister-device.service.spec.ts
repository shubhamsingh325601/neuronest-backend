import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { UnregisterDeviceService } from './unregister-device.service';

describe('UnregisterDeviceService', () => {
  const prisma = { deviceToken: { deleteMany: jest.fn() } };
  let service: UnregisterDeviceService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UnregisterDeviceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UnregisterDeviceService);
  });

  it("removes only the caller's own token", async () => {
    await service.unregister('user-1', { token: 'token-aaaaaaaaaa' });
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', token: 'token-aaaaaaaaaa' },
    });
  });

  it('is harmless to repeat', async () => {
    prisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.unregister('user-1', { token: 'token-aaaaaaaaaa' }),
    ).resolves.toBeUndefined();
  });
});

import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { RegisterDeviceService } from './register-device.service';

describe('RegisterDeviceService', () => {
  const prisma = { deviceToken: { upsert: jest.fn() } };
  let service: RegisterDeviceService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [RegisterDeviceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RegisterDeviceService);
  });

  it('saves the token for the user, as android unless told otherwise', async () => {
    await service.register('user-1', { token: 'token-aaaaaaaaaa' });
    expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
      where: { token: 'token-aaaaaaaaaa' },
      create: { userId: 'user-1', token: 'token-aaaaaaaaaa', platform: 'android' },
      update: expect.objectContaining({ userId: 'user-1', platform: 'android' }),
    });
  });

  it('moves a token to the new user when the phone is shared', async () => {
    await service.register('user-2', { token: 'token-aaaaaaaaaa', platform: 'ios' });
    expect(prisma.deviceToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ userId: 'user-2', platform: 'ios' }),
      }),
    );
  });
});

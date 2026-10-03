import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ReactivateUserService } from './reactivate-user.service';

describe('ReactivateUserService', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  let service: ReactivateUserService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ReactivateUserService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ReactivateUserService);
  });

  it('404s when the target user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.reactivate('missing')).rejects.toThrow(NotFoundException);
  });

  it('reactivates a SUSPENDED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.SUSPENDED,
      updatedAt: new Date(),
    });
    const updated = { id: 'u1', status: UserStatus.ACTIVE, updatedAt: new Date() };
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.reactivate('u1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: UserStatus.ACTIVE },
      select: { id: true, status: true, updatedAt: true },
    });
    expect(result).toEqual(updated);
  });

  it('reactivates a DEACTIVATED (self-excluded) user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.DEACTIVATED,
      updatedAt: new Date(),
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      status: UserStatus.ACTIVE,
      updatedAt: new Date(),
    });

    await service.reactivate('u1');
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('is idempotent when the user is already ACTIVE', async () => {
    const current = { id: 'u1', status: UserStatus.ACTIVE, updatedAt: new Date() };
    prisma.user.findUnique.mockResolvedValue(current);

    const result = await service.reactivate('u1');

    expect(result).toEqual(current);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('409s reactivating an INVITED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: UserStatus.INVITED,
      updatedAt: new Date(),
    });
    await expect(service.reactivate('u1')).rejects.toThrow(ConflictException);
  });
});

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { UpdateMeService } from './update-me.service';

describe('UpdateMeService', () => {
  const user = { update: jest.fn() };
  let service: UpdateMeService;

  beforeEach(async () => {
    user.update.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [UpdateMeService, { provide: PrismaService, useValue: { user } }],
    }).compile();
    service = moduleRef.get(UpdateMeService);
  });

  it('trims and stores the new name', async () => {
    user.update.mockResolvedValue({ id: 'u1', name: 'Priya Sharma' });
    await service.update('u1', { name: '  Priya Sharma ' });
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { name: 'Priya Sharma' } }),
    );
  });

  it('404s when the account no longer exists', async () => {
    user.update.mockRejectedValue(new Error('not found'));
    await expect(service.update('u1', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

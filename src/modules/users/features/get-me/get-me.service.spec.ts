import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetMeService } from './get-me.service';

describe('GetMeService', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let service: GetMeService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GetMeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GetMeService);
  });

  it('selects only non-sensitive columns (no passwordHash)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'p@example.com' });
    await service.getProfile('u1');
    const arg = prisma.user.findUnique.mock.calls[0][0];
    expect(arg.select.passwordHash).toBeUndefined();
    expect(arg.select).toMatchObject({ id: true, email: true, role: true, status: true });
  });

  it('throws NotFound when the user is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

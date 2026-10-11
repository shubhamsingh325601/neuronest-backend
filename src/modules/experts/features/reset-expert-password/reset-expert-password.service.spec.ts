import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { ResetExpertPasswordService } from './reset-expert-password.service';

describe('ResetExpertPasswordService', () => {
  const prisma = { user: { findFirst: jest.fn(), update: jest.fn() } };
  const passwords = { hash: jest.fn() };
  const refreshTokens = { revokeAllForUser: jest.fn() };
  let service: ResetExpertPasswordService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResetExpertPasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(ResetExpertPasswordService);
  });

  it('stores the new hash, then revokes every refresh token of the expert', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'ex-1' });
    passwords.hash.mockResolvedValue('hashed');

    await service.reset('ex-1', { newPassword: 'a-new-strong-pass' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'ex-1', role: 'EXPERT' },
      select: { id: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'ex-1' },
      data: { passwordHash: 'hashed' },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('ex-1');
    expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      refreshTokens.revokeAllForUser.mock.invocationCallOrder[0],
    );
  });

  it('404s EXPERT_NOT_FOUND for a user that is not an expert and changes nothing', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.reset('x', { newPassword: 'a-new-strong-pass' })).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });
});

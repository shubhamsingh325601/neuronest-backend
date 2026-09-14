import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { DeactivateService } from './deactivate.service';

describe('DeactivateService', () => {
  const prisma = { user: { update: jest.fn() } };
  const refreshTokens = { revokeAllForUser: jest.fn() };
  let service: DeactivateService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeactivateService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(DeactivateService);
  });

  it('sets status=DEACTIVATED + selfExcludedAt and revokes sessions', async () => {
    const selfExcludedAt = new Date();
    prisma.user.update.mockResolvedValue({ status: 'DEACTIVATED', selfExcludedAt });

    const result = await service.deactivate('u1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'DEACTIVATED', selfExcludedAt: expect.any(Date) },
      select: { status: true, selfExcludedAt: true },
    });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ status: 'DEACTIVATED', selfExcludedAt });
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AccessTokenService } from '@common/authz/access-token.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const prisma = {
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const accessTokens = { issue: jest.fn() };
  const config = {
    get: jest.fn().mockReturnValue({ refreshTtlDays: 30, accessSecret: 's', accessTtl: '15m' }),
  };
  let service: RefreshTokenService;

  beforeEach(async () => {
    jest.resetAllMocks();
    config.get.mockReturnValue({ refreshTtlDays: 30, accessSecret: 's', accessTtl: '15m' });
    accessTokens.issue.mockResolvedValue({ accessToken: 'access', expiresIn: 900 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccessTokenService, useValue: accessTokens },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(RefreshTokenService);
  });

  it('issues an access + refresh pair and persists only the token hash', async () => {
    prisma.refreshToken.create.mockResolvedValue({});
    const session = await service.issueSession({
      id: 'u1',
      email: 'p@example.com',
      role: 'PARENT',
      status: 'ACTIVE',
    });

    expect(session.accessToken).toBe('access');
    expect(session.refreshToken).toEqual(expect.any(String));
    const createArg = prisma.refreshToken.create.mock.calls[0][0];
    expect(createArg.data.tokenHash).not.toEqual(session.refreshToken);
    expect(createArg.data.userId).toBe('u1');
  });

  it('rotates a valid token: revokes the old row, issues a new pair', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
      user: { id: 'u1', email: 'p@example.com', role: 'PARENT', status: 'ACTIVE' },
    });
    prisma.refreshToken.create.mockResolvedValue({});

    await service.rotate('some-token');

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  it('treats reuse of a revoked token as compromise and revokes the whole family', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
      user: { id: 'u1' },
    });

    await expect(service.rotate('stolen')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects an unknown token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('nope')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

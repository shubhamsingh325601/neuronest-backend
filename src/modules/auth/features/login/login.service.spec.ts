import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { LoginService } from './login.service';

describe('LoginService', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const passwords = { verify: jest.fn() };
  const refreshTokens = { issueSession: jest.fn() };
  let service: LoginService;

  const activeVerifiedUser = {
    id: 'u1',
    email: 'p@example.com',
    passwordHash: 'hash',
    role: 'PARENT',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        { provide: RefreshTokenService, useValue: refreshTokens },
      ],
    }).compile();
    service = moduleRef.get(LoginService);
  });

  it('issues a session and stamps lastLoginAt on success', async () => {
    prisma.user.findUnique.mockResolvedValue(activeVerifiedUser);
    passwords.verify.mockResolvedValue(true);
    refreshTokens.issueSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const result = await service.login({ email: 'P@example.com', password: 'pw' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('rejects an unknown email as INVALID_CREDENTIALS', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'x@example.com', password: 'pw' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a wrong password as INVALID_CREDENTIALS', async () => {
    prisma.user.findUnique.mockResolvedValue(activeVerifiedUser);
    passwords.verify.mockResolvedValue(false);
    await expect(service.login({ email: 'p@example.com', password: 'bad' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('blocks an unverified email with EMAIL_NOT_VERIFIED', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeVerifiedUser, emailVerifiedAt: null });
    passwords.verify.mockResolvedValue(true);
    await expect(service.login({ email: 'p@example.com', password: 'pw' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks a deactivated account with ACCOUNT_NOT_ACTIVE', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeVerifiedUser, status: 'DEACTIVATED' });
    passwords.verify.mockResolvedValue(true);
    await expect(service.login({ email: 'p@example.com', password: 'pw' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

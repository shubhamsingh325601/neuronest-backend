import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sha256 } from '@common/crypto/token.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from './verification-token.service';

describe('VerificationTokenService — ACCOUNT_SETUP', () => {
  const verificationToken = {
    updateMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { verificationToken };
  const config = {
    get: jest.fn().mockReturnValue({
      emailTtlMin: 10,
      emailMaxAttempts: 5,
      passwordResetTtlMin: 60,
      accountSetupTtlMin: 60,
    }),
  };
  let service: VerificationTokenService;

  beforeEach(async () => {
    jest.resetAllMocks();
    config.get.mockReturnValue({
      emailTtlMin: 10,
      emailMaxAttempts: 5,
      passwordResetTtlMin: 60,
      accountSetupTtlMin: 60,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerificationTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(VerificationTokenService);
  });

  describe('issueAccountSetupToken', () => {
    it('consumes any outstanding ACCOUNT_SETUP token, then stores only the hash of a fresh one', async () => {
      verificationToken.updateMany.mockResolvedValue({ count: 1 });
      verificationToken.create.mockResolvedValue({ id: 'vt1' });

      const token = await service.issueAccountSetupToken('u1');

      expect(token).toEqual(expect.any(String));
      expect(verificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: 'ACCOUNT_SETUP', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      const createArg = verificationToken.create.mock.calls[0][0];
      expect(createArg.data).toMatchObject({
        userId: 'u1',
        type: 'ACCOUNT_SETUP',
        channel: 'EMAIL',
        tokenHash: sha256(token),
      });
      expect(createArg.data.tokenHash).not.toEqual(token);
      expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('consumeAccountSetupToken', () => {
    it('returns the user id and consumes the row on a valid token', async () => {
      verificationToken.findFirst.mockResolvedValue({ id: 'vt1', userId: 'u1' });

      await expect(service.consumeAccountSetupToken('t'.repeat(43))).resolves.toBe('u1');

      expect(verificationToken.findFirst).toHaveBeenCalledWith({
        where: {
          type: 'ACCOUNT_SETUP',
          tokenHash: sha256('t'.repeat(43)),
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
      expect(verificationToken.update).toHaveBeenCalledWith({
        where: { id: 'vt1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('returns null and consumes nothing for an unknown / expired / used token', async () => {
      verificationToken.findFirst.mockResolvedValue(null);

      await expect(service.consumeAccountSetupToken('x'.repeat(43))).resolves.toBeNull();
      expect(verificationToken.update).not.toHaveBeenCalled();
    });
  });
});

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { AccessTokenService } from '@common/authz/access-token.service';
import { generateOpaqueToken, sha256 } from '@common/crypto/token.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { SessionTokensDto } from './session-tokens.dto';

type SessionUser = Pick<User, 'id' | 'email' | 'role' | 'status'>;

/**
 * Owns the refresh-token lifecycle: issue, rotate, revoke.
 *
 * Refresh tokens are opaque random strings; only their SHA-256 hash is persisted.
 * Rotation revokes the presented token and issues a fresh one. Presenting an already
 * revoked token is treated as theft: the user's entire token set is revoked.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlMs = config.get('jwt', { infer: true }).refreshTtlDays * 86_400_000;
  }

  /** Mint a new access + refresh pair for a freshly authenticated user. */
  async issueSession(user: SessionUser): Promise<SessionTokensDto> {
    const { accessToken, expiresIn } = await this.accessTokens.issue(user);
    const refreshToken = await this.createRefreshToken(user.id);
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn };
  }

  /** Validate + rotate a presented refresh token. */
  async rotate(presentedToken: string): Promise<SessionTokensDto> {
    const tokenHash = sha256(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is not recognised.',
      });
    }

    if (existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      if (existing.revokedAt) {
        // Reuse of a revoked token -> assume compromise, drop every session.
        this.logger.warn(
          { userId: existing.userId },
          'Revoked refresh token reused — revoking all sessions for user',
        );
        await this.revokeAllForUser(existing.userId);
      }
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is expired or has been revoked.',
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(existing.user);
  }

  /** Revoke a single token (logout). Idempotent — unknown tokens are ignored. */
  async revoke(presentedToken: string): Promise<void> {
    const tokenHash = sha256(presentedToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const token = generateOpaqueToken(32);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return token;
  }
}

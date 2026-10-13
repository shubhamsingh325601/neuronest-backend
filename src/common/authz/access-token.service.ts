import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import type { JwtPayload } from './jwt-payload.type';

@Injectable()
export class AccessTokenService {
  private readonly secret: string;
  private readonly ttl: string;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService<AppConfig, true>,
  ) {
    const jwt = config.get('jwt', { infer: true });
    this.secret = jwt.accessSecret;
    this.ttl = jwt.accessTtl;
  }

  /**
   * Returns `{ accessToken, expiresIn }` (expiresIn in seconds). `options.impersonatedBy` marks a token
   * an ADMIN is using to act as `user`; `options.ttl` overrides the normal lifetime (same "15m" form).
   */
  async issue(
    user: Pick<User, 'id' | 'email' | 'role' | 'status'>,
    options: { impersonatedBy?: string; ttl?: string } = {},
  ): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const ttl = options.ttl ?? this.ttl;
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      ...(options.impersonatedBy ? { imp: options.impersonatedBy } : {}),
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.secret,
      // jsonwebtoken accepts a duration string ("15m"); its types are stricter than that.
      expiresIn: ttl as unknown as number,
    });
    return { accessToken, expiresIn: this.ttlSeconds(ttl) };
  }

  private ttlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) {
      const asNumber = Number(ttl);
      return Number.isFinite(asNumber) ? asNumber : 900;
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * multipliers[unit];
  }
}

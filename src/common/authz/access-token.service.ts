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

  /** Returns `{ accessToken, expiresIn }` (expiresIn in seconds). */
  async issue(user: Pick<User, 'id' | 'email' | 'role' | 'status'>): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.secret,
      // jsonwebtoken accepts a duration string ("15m"); its types are stricter than that.
      expiresIn: this.ttl as unknown as number,
    });
    return { accessToken, expiresIn: this.ttlSeconds() };
  }

  private ttlSeconds(): number {
    const match = /^(\d+)([smhd])$/.exec(this.ttl.trim());
    if (!match) {
      const asNumber = Number(this.ttl);
      return Number.isFinite(asNumber) ? asNumber : 900;
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * multipliers[unit];
  }
}

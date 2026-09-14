import { Injectable } from '@nestjs/common';
import { RefreshTokenService } from '@modules/auth/shared/refresh-token.service';
import { LogoutDto } from './dto/logout.dto';

@Injectable()
export class LogoutService {
  constructor(private readonly refreshTokens: RefreshTokenService) {}

  /** Idempotent — revoking an unknown or already-revoked token is a no-op. */
  async logout(dto: LogoutDto): Promise<void> {
    await this.refreshTokens.revoke(dto.refreshToken);
  }
}

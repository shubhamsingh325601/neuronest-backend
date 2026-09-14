import { Injectable } from '@nestjs/common';
import { RefreshTokenService as RefreshTokenStore } from '@modules/auth/shared/refresh-token.service';
import { SessionTokensDto } from '@modules/auth/shared/session-tokens.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Feature service for POST /v1/auth/refresh. The rotation + reuse-detection logic
 * lives in the shared {@link RefreshTokenStore}; this is the use-case entry point.
 */
@Injectable()
export class RefreshTokenFeatureService {
  constructor(private readonly store: RefreshTokenStore) {}

  refresh(dto: RefreshTokenDto): Promise<SessionTokensDto> {
    return this.store.rotate(dto.refreshToken);
  }
}

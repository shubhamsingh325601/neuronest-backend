import { ApiProperty } from '@nestjs/swagger';

/** Returned by login, refresh, and any flow that starts a new session. */
export class SessionTokensDto {
  @ApiProperty({ description: 'Short-lived JWT for the Authorization header.' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque refresh token. Store securely; single use.' })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ description: 'Access-token lifetime in seconds.', example: 900 })
  expiresIn!: number;
}

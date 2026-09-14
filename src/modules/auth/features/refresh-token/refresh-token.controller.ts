import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { SessionTokensDto } from '@modules/auth/shared/session-tokens.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenFeatureService } from './refresh-token.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/refresh', version: '1' })
export class RefreshTokenController {
  constructor(private readonly refreshTokenService: RefreshTokenFeatureService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionTokensDto })
  @ApiOperation({
    operationId: 'authRefresh',
    summary: 'Rotate a refresh token, returning a new access + refresh pair.',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<SessionTokensDto> {
    return this.refreshTokenService.refresh(dto);
  }
}

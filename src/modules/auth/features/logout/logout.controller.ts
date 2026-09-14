import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { LogoutDto } from './dto/logout.dto';
import { LogoutService } from './logout.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/logout', version: '1' })
export class LogoutController {
  constructor(private readonly logoutService: LogoutService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Refresh token revoked (idempotent).' })
  @ApiOperation({ operationId: 'authLogout', summary: 'Revoke a refresh token.' })
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.logoutService.logout(dto);
  }
}

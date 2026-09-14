import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { SessionTokensDto } from '@modules/auth/shared/session-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { LoginService } from './login.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/login', version: '1' })
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionTokensDto })
  @ApiOperation({
    operationId: 'authLogin',
    summary: 'Exchange email + password for an access token and a refresh token.',
  })
  login(@Body() dto: LoginDto): Promise<SessionTokensDto> {
    return this.loginService.login(dto);
  }
}

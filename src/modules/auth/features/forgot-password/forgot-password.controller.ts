import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordService } from './forgot-password.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/forgot-password', version: '1' })
export class ForgotPasswordController {
  constructor(private readonly forgotPasswordService: ForgotPasswordService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Accepted. A reset link is sent if the account exists.' })
  @ApiOperation({
    operationId: 'authForgotPassword',
    summary: 'Send a password-reset link to the account email.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.forgotPasswordService.requestReset(dto);
  }
}

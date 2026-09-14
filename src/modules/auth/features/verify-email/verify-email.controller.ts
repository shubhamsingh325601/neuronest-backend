import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import {
  ResendVerificationDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
} from './dto/verify-email.dto';
import { VerifyEmailService } from './verify-email.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth', version: '1' })
export class VerifyEmailController {
  constructor(private readonly verifyEmailService: VerifyEmailService) {}

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'authVerifyEmail',
    summary: 'Confirm an email address with the 6-digit code.',
  })
  verify(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    return this.verifyEmailService.verify(dto);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Accepted. A new code is sent if the account is eligible.' })
  @ApiOperation({
    operationId: 'authResendVerification',
    summary: 'Request a fresh email verification code.',
  })
  async resend(@Body() dto: ResendVerificationDto): Promise<void> {
    await this.verifyEmailService.resend(dto);
  }
}

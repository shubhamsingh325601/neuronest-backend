import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { ResetPasswordDto, ResetPasswordResponseDto } from './dto/reset-password.dto';
import { ResetPasswordService } from './reset-password.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/reset-password', version: '1' })
export class ResetPasswordController {
  constructor(private readonly resetPasswordService: ResetPasswordService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  @ApiOperation({
    operationId: 'authResetPassword',
    summary: 'Set a new password using a reset token; revokes all sessions.',
  })
  reset(@Body() dto: ResetPasswordDto): Promise<ResetPasswordResponseDto> {
    return this.resetPasswordService.reset(dto);
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { SignupService } from './signup.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/signup', version: '1' })
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post()
  @Public()
  @ApiOperation({
    operationId: 'authSignup',
    summary: 'Register a parent/guardian account and send an email verification code.',
  })
  signup(@Body() dto: SignupDto): Promise<SignupResponseDto> {
    return this.signupService.signup(dto);
  }
}

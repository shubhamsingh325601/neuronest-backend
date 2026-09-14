import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import {
  CompleteAccountSetupDto,
  CompleteAccountSetupResponseDto,
} from './dto/complete-account-setup.dto';
import { CompleteAccountSetupService } from './complete-account-setup.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/complete-account-setup', version: '1' })
export class CompleteAccountSetupController {
  constructor(private readonly completeAccountSetupService: CompleteAccountSetupService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CompleteAccountSetupResponseDto })
  @ApiOperation({
    operationId: 'authCompleteAccountSetup',
    summary: 'Set the first password for an invited account using an account-setup token.',
  })
  complete(@Body() dto: CompleteAccountSetupDto): Promise<CompleteAccountSetupResponseDto> {
    return this.completeAccountSetupService.complete(dto);
  }
}

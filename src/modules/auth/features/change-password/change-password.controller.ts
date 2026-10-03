import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { AuthThrottle } from '@common/throttler/throttle.config';
import { ChangePasswordDto, ChangePasswordResponseDto } from './dto/change-password.dto';
import { ChangePasswordService } from './change-password.service';

@ApiTags('auth')
@AuthThrottle()
@Controller({ path: 'auth/change-password', version: '1' })
export class ChangePasswordController {
  constructor(private readonly changePasswordService: ChangePasswordService) {}

  @Post()
  @Auth('user:change-password:self')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ChangePasswordResponseDto })
  @ApiOperation({
    operationId: 'authChangePassword',
    summary: 'Change your own password while authenticated; revokes all sessions.',
  })
  change(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponseDto> {
    return this.changePasswordService.change(userId, dto);
  }
}

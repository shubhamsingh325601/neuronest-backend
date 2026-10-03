import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { UserStatusResponseDto } from '@modules/users/shared/user-status.dto';
import { SuspendUserService } from './suspend-user.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class SuspendUserController {
  constructor(private readonly suspendUserService: SuspendUserService) {}

  @Post(':id/suspend')
  @Auth('user:manage-status')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserStatusResponseDto })
  @ApiOperation({
    operationId: 'userSuspend',
    summary: 'Admin: suspend a user and revoke all of their sessions.',
  })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') callerId: string,
  ): Promise<UserStatusResponseDto> {
    return this.suspendUserService.suspend(id, callerId);
  }
}

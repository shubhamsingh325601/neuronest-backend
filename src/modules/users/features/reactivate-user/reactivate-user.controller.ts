import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { UserStatusResponseDto } from '@modules/users/shared/user-status.dto';
import { ReactivateUserService } from './reactivate-user.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class ReactivateUserController {
  constructor(private readonly reactivateUserService: ReactivateUserService) {}

  @Post(':id/reactivate')
  @Auth('user:manage-status')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserStatusResponseDto })
  @ApiOperation({
    operationId: 'userReactivate',
    summary: 'Admin: reactivate a suspended or self-deactivated user.',
  })
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<UserStatusResponseDto> {
    return this.reactivateUserService.reactivate(id);
  }
}

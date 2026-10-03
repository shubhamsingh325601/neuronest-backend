import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { UserDetailDto } from '@modules/users/shared/user-detail.dto';
import { GetUserService } from './get-user.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class GetUserController {
  constructor(private readonly getUserService: GetUserService) {}

  @Get(':id')
  @Auth('user:list')
  @ApiOkResponse({ type: UserDetailDto })
  @ApiOperation({
    operationId: 'userGet',
    summary: 'Admin: read a single user, with relations resolved (child / assigned children).',
  })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<UserDetailDto> {
    return this.getUserService.getById(id);
  }
}

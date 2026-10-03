import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ListUsersQueryDto } from './dto/list-users.query.dto';
import { ListUsersResponseDto } from './dto/list-users.response.dto';
import { ListUsersService } from './list-users.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class ListUsersController {
  constructor(private readonly listUsersService: ListUsersService) {}

  @Get()
  @Auth('user:list')
  @ApiOkResponse({ type: ListUsersResponseDto })
  @ApiOperation({
    operationId: 'userList',
    summary: 'Admin: cursor-paginated directory of every user, optionally filtered by ?role=&status=.',
  })
  list(@Query() query: ListUsersQueryDto): Promise<ListUsersResponseDto> {
    return this.listUsersService.list(query);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { UserProfileDto } from './dto/user-profile.dto';
import { GetMeService } from './get-me.service';

@ApiTags('users')
@Controller({ path: 'users/me', version: '1' })
export class GetMeController {
  constructor(private readonly getMeService: GetMeService) {}

  @Get()
  @Auth('user:read:self')
  @ApiOkResponse({ type: UserProfileDto })
  @ApiOperation({ operationId: 'usersGetMe', summary: "The authenticated user's profile." })
  getMe(@CurrentUser('id') userId: string): Promise<UserProfileDto> {
    return this.getMeService.getProfile(userId);
  }
}

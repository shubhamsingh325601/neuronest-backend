import { Body, Controller, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { UserProfileDto } from '@modules/users/features/get-me/dto/user-profile.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateMeService } from './update-me.service';

@ApiTags('users')
@Controller({ path: 'users/me', version: '1' })
export class UpdateMeController {
  constructor(private readonly updateMeService: UpdateMeService) {}

  @Patch()
  @Auth('user:update:self')
  @ApiOkResponse({ type: UserProfileDto })
  @ApiOperation({
    operationId: 'usersUpdateMe',
    summary: "Update the authenticated user's display name (email changes are not supported yet).",
  })
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto): Promise<UserProfileDto> {
    return this.updateMeService.update(userId, dto);
  }
}

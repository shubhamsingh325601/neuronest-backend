import { Body, Controller, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { PreferencesDto } from '@modules/users/shared/preferences.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdatePreferencesService } from './update-preferences.service';

@ApiTags('users')
@Controller({ path: 'users/me/preferences', version: '1' })
export class UpdatePreferencesController {
  constructor(private readonly updatePreferencesService: UpdatePreferencesService) {}

  @Patch()
  @Auth('user:update:self')
  @ApiOkResponse({ type: PreferencesDto })
  @ApiOperation({
    operationId: 'usersUpdatePreferences',
    summary: "Change any of the authenticated user's notification and archive choices.",
  })
  update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<PreferencesDto> {
    return this.updatePreferencesService.update(userId, dto);
  }
}
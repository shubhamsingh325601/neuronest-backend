import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { PreferencesDto } from '@modules/users/shared/preferences.dto';
import { GetPreferencesService } from './get-preferences.service';

@ApiTags('users')
@Controller({ path: 'users/me/preferences', version: '1' })
export class GetPreferencesController {
  constructor(private readonly getPreferencesService: GetPreferencesService) {}

  @Get()
  @Auth('user:read:self')
  @ApiOkResponse({ type: PreferencesDto })
  @ApiOperation({
    operationId: 'usersGetPreferences',
    summary: "The authenticated user's notification and archive choices (defaults until first saved).",
  })
  get(@CurrentUser('id') userId: string): Promise<PreferencesDto> {
    return this.getPreferencesService.get(userId);
  }
}
import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { DeactivateResponseDto } from './dto/deactivate.dto';
import { DeactivateService } from './deactivate.service';

@ApiTags('users')
@Controller({ path: 'users/me/deactivate', version: '1' })
export class DeactivateController {
  constructor(private readonly deactivateService: DeactivateService) {}

  @Post()
  @Auth('user:deactivate:self')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DeactivateResponseDto })
  @ApiOperation({
    operationId: 'usersDeactivateMe',
    summary: 'Self-exclude: deactivate your own account and end all sessions.',
  })
  deactivate(@CurrentUser('id') userId: string): Promise<DeactivateResponseDto> {
    return this.deactivateService.deactivate(userId);
  }
}

import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ImpersonationResponseDto } from './dto/impersonation.response.dto';
import { ImpersonateUserService } from './impersonate-user.service';

@ApiTags('admin')
@Controller({ path: 'users', version: '1' })
export class ImpersonateUserController {
  constructor(private readonly impersonateUserService: ImpersonateUserService) {}

  @Post(':id/impersonate')
  @Auth('user:impersonate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImpersonationResponseDto })
  @ApiOperation({
    operationId: 'userImpersonate',
    summary:
      'Admin, TEMPORARY testing aid: get a short-lived token that acts as a parent (404 unless IMPERSONATION_ENABLED).',
  })
  impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ImpersonationResponseDto> {
    return this.impersonateUserService.impersonate(id, admin);
  }
}

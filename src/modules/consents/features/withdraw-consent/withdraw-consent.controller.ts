import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConsentStateDto } from '@modules/consents/shared/consent.dto';
import { WithdrawConsentService } from './withdraw-consent.service';

@ApiTags('consents')
@Controller({ path: 'children', version: '1' })
export class WithdrawConsentController {
  constructor(private readonly withdrawConsentService: WithdrawConsentService) {}

  @Post(':childId/consent/withdraw')
  @HttpCode(200)
  @Auth('consent:manage:self')
  @ApiOkResponse({ type: ConsentStateDto })
  @ApiOperation({
    operationId: 'consentWithdraw',
    summary: 'PARENT(own child): withdraw the open media consent. Idempotent.',
  })
  withdraw(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConsentStateDto> {
    return this.withdrawConsentService.withdraw(childId, caller);
  }
}

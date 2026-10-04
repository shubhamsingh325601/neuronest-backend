import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConsentStateDto } from '@modules/consents/shared/consent.dto';
import { GetConsentService } from './get-consent.service';

@ApiTags('consents')
@Controller({ path: 'children', version: '1' })
export class GetConsentController {
  constructor(private readonly getConsentService: GetConsentService) {}

  @Get(':childId/consent')
  @Auth('consent:read')
  @ApiOkResponse({ type: ConsentStateDto })
  @ApiOperation({
    operationId: 'consentGet',
    summary: "Read a child's media-consent state and history — the child's parent or admin.",
  })
  get(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ConsentStateDto> {
    return this.getConsentService.get(childId, caller);
  }
}

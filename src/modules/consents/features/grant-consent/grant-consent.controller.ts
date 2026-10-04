import { Body, Controller, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ConsentRecordDto } from '@modules/consents/shared/consent.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { GrantConsentService } from './grant-consent.service';

@ApiTags('consents')
@Controller({ path: 'children', version: '1' })
export class GrantConsentController {
  constructor(private readonly grantConsentService: GrantConsentService) {}

  @Post(':childId/consent')
  @Auth('consent:manage:self')
  @ApiCreatedResponse({ type: ConsentRecordDto, description: 'A new consent row was recorded.' })
  @ApiOkResponse({ type: ConsentRecordDto, description: 'Same version already open (idempotent).' })
  @ApiOperation({
    operationId: 'consentGrant',
    summary: 'PARENT(own child): grant media consent for a wording version. Idempotent per version.',
  })
  async grant(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: GrantConsentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConsentRecordDto> {
    const { record, created } = await this.grantConsentService.grant(childId, caller, dto);
    res.status(created ? 201 : 200);
    return record;
  }
}

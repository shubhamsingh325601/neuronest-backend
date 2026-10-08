import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { GetActiveEscalationService } from './get-active-escalation.service';

@ApiTags('escalations')
@Controller({ path: 'children', version: '1' })
export class GetActiveEscalationController {
  constructor(private readonly getActiveEscalationService: GetActiveEscalationService) {}

  @Get(':childId/escalations/active')
  @Auth('escalation:read')
  @ApiOkResponse({ type: EscalationDto })
  @ApiOperation({
    operationId: 'escalationActive',
    summary:
      "The child's open or acknowledged urgent-support request (404 ESCALATION_NOT_FOUND if none).",
  })
  active(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<EscalationDto> {
    return this.getActiveEscalationService.active(childId, caller);
  }
}

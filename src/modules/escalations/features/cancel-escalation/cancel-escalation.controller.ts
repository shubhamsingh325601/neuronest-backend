import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { CancelEscalationService } from './cancel-escalation.service';

@ApiTags('escalations')
@Controller({ path: 'escalations', version: '1' })
export class CancelEscalationController {
  constructor(private readonly cancelEscalationService: CancelEscalationService) {}

  @Post(':id/cancel')
  @Auth('escalation:create:self')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EscalationDto })
  @ApiOperation({
    operationId: 'escalationCancel',
    summary:
      'PARENT(own child): cancel an active urgent-support request because the situation settled (idempotent).',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<EscalationDto> {
    return this.cancelEscalationService.cancel(id, caller);
  }
}

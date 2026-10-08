import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';
import { HandleEscalationService } from './handle-escalation.service';

@ApiTags('escalations')
@Controller({ path: 'escalations', version: '1' })
export class HandleEscalationController {
  constructor(private readonly handleEscalationService: HandleEscalationService) {}

  @Post(':id/acknowledge')
  @Auth('escalation:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EscalationDto })
  @ApiOperation({
    operationId: 'escalationAcknowledge',
    summary: 'CLINICIAN(assigned)/ADMIN: acknowledge an open request (idempotent).',
  })
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<EscalationDto> {
    return this.handleEscalationService.acknowledge(id, caller);
  }

  @Post(':id/resolve')
  @Auth('escalation:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EscalationDto })
  @ApiOperation({
    operationId: 'escalationResolve',
    summary:
      'CLINICIAN(assigned)/ADMIN: resolve a request with an optional note for the parent (idempotent).',
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ResolveEscalationDto,
  ): Promise<EscalationDto> {
    return this.handleEscalationService.resolve(id, caller, dto);
  }
}

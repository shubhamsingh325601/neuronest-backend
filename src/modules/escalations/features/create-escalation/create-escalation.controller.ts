import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { CreateEscalationDto } from './dto/create-escalation.dto';
import { CreateEscalationService } from './create-escalation.service';

@ApiTags('escalations')
@Controller({ path: 'children', version: '1' })
export class CreateEscalationController {
  constructor(private readonly createEscalationService: CreateEscalationService) {}

  @Post(':childId/escalations')
  @Auth('escalation:create:self')
  @ApiCreatedResponse({ type: EscalationDto })
  @ApiOperation({
    operationId: 'escalationCreate',
    summary:
      'PARENT(own child): raise an urgent-support request for clinician review within 24 h. One active request per child (409 ESCALATION_ALREADY_ACTIVE).',
  })
  create(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateEscalationDto,
  ): Promise<EscalationDto> {
    return this.createEscalationService.create(childId, caller, dto);
  }
}

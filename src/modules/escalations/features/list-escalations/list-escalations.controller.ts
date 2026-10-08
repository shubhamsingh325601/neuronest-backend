import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { EscalationPageDto } from '@modules/escalations/shared/escalation.dto';
import { ListEscalationsQueryDto } from './list-escalations.dto';
import { ListEscalationsService } from './list-escalations.service';

@ApiTags('escalations')
@Controller({ path: 'escalations', version: '1' })
export class ListEscalationsController {
  constructor(private readonly listEscalationsService: ListEscalationsService) {}

  @Get()
  @Auth('escalation:manage')
  @ApiOkResponse({ type: EscalationPageDto })
  @ApiOperation({
    operationId: 'escalationList',
    summary:
      'CLINICIAN(assigned children)/ADMIN(all): the review queue of urgent-support requests, oldest deadline first; filter by `status` or `overdue`.',
  })
  list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListEscalationsQueryDto,
  ): Promise<EscalationPageDto> {
    return this.listEscalationsService.list(caller, query);
  }
}

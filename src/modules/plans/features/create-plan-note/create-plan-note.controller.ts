import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanNoteDto } from '@modules/plans/shared/plan-note.dto';
import { CreatePlanNoteDto } from './dto/create-plan-note.dto';
import { CreatePlanNoteService } from './create-plan-note.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class CreatePlanNoteController {
  constructor(private readonly createPlanNoteService: CreatePlanNoteService) {}

  @Post(':id/notes')
  @Auth('plan-note:create')
  @ApiCreatedResponse({ type: PlanNoteDto })
  @ApiOperation({
    operationId: 'planNoteCreate',
    summary: 'CLINICIAN(assigned)/ADMIN: leave a note on a plan.',
  })
  create(
    @Param('id', ParseUUIDPipe) planId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreatePlanNoteDto,
  ): Promise<PlanNoteDto> {
    return this.createPlanNoteService.create(planId, caller, dto);
  }
}

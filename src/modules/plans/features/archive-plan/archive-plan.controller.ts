import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanDto } from '@modules/plans/shared/plan.dto';
import { ArchivePlanService } from './archive-plan.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class ArchivePlanController {
  constructor(private readonly archivePlanService: ArchivePlanService) {}

  @Post(':id/archive')
  @Auth('plan:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlanDto })
  @ApiOperation({
    operationId: 'planArchive',
    summary: 'CLINICIAN(assigned)/ADMIN: archive a plan — idempotent, 409 if already completed.',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<PlanDto> {
    return this.archivePlanService.archive(id, caller);
  }
}

import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PlanSectionDto } from '@modules/plans/shared/plan-template.dto';
import { ReplacePlanSectionsDto } from './dto/replace-plan-sections.dto';
import { ReplacePlanSectionsService } from './replace-plan-sections.service';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class ReplacePlanSectionsController {
  constructor(private readonly replacePlanSectionsService: ReplacePlanSectionsService) {}

  @Put(':id/sections')
  @Auth('plan:manage')
  @ApiOkResponse({ type: [PlanSectionDto] })
  @ApiOperation({
    operationId: 'planSectionsReplace',
    summary: 'CLINICIAN(assigned)/ADMIN: replace the section list of an ACTIVE plan.',
  })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ReplacePlanSectionsDto,
  ): Promise<PlanSectionDto[]> {
    return this.replacePlanSectionsService.replace(id, caller, dto);
  }
}

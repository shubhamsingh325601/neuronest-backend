import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ChildDto } from '@modules/children/shared/child.dto';
import { ClinicalProfileDto } from '@modules/children/shared/clinical-profile.dto';
import { SetClinicalProfileService } from './set-clinical-profile.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class SetClinicalProfileController {
  constructor(private readonly setClinicalProfileService: SetClinicalProfileService) {}

  @Put(':id/clinical-profile')
  @Auth('child-clinical-profile:manage')
  @ApiOkResponse({ type: ChildDto })
  @ApiOperation({
    operationId: 'childClinicalProfileSet',
    summary: "CLINICIAN(assigned)/ADMIN: replace the child's clinician-authored profile.",
  })
  set(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ClinicalProfileDto,
  ): Promise<ChildDto> {
    return this.setClinicalProfileService.set(id, caller, dto);
  }
}

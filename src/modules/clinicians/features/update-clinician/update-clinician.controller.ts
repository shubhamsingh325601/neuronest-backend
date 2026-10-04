import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { UpdateClinicianDto } from '@modules/clinicians/shared/update-clinician.dto';
import { UpdateClinicianService } from './update-clinician.service';

@ApiTags('clinicians')
@Controller({ path: 'clinicians', version: '1' })
export class UpdateClinicianController {
  constructor(private readonly updateClinicianService: UpdateClinicianService) {}

  @Patch(':id')
  @Auth('clinician:manage')
  @ApiOkResponse({ type: ClinicianDetailDto })
  @ApiOperation({
    operationId: 'clinicianUpdate',
    summary: 'Admin: update name, profile, or (while INVITED) email of a clinician.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClinicianDto,
  ): Promise<ClinicianDetailDto> {
    return this.updateClinicianService.update(id, dto);
  }
}

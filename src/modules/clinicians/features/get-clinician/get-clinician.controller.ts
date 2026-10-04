import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { GetClinicianService } from './get-clinician.service';

@ApiTags('clinicians')
@Controller({ path: 'clinicians', version: '1' })
export class GetClinicianController {
  constructor(private readonly getClinicianService: GetClinicianService) {}

  @Get(':id')
  @Auth('clinician:list')
  @ApiOkResponse({ type: ClinicianDetailDto })
  @ApiOperation({
    operationId: 'clinicianGet',
    summary: 'Admin: one clinician with profile, lifecycle timestamps and assigned children.',
  })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ClinicianDetailDto> {
    return this.getClinicianService.get(id);
  }
}

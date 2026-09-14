import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';
import { GetApplicationService } from './get-application.service';

@ApiTags('clinicians')
@Controller({ path: 'clinician-applications', version: '1' })
export class GetApplicationController {
  constructor(private readonly getApplicationService: GetApplicationService) {}

  @Get(':id')
  @Auth('clinician-application:list')
  @ApiOkResponse({ type: ClinicianApplicationDto })
  @ApiOperation({
    operationId: 'clinicianApplicationGet',
    summary: 'Admin: fetch a single clinician application.',
  })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClinicianApplicationDto> {
    return this.getApplicationService.getById(id);
  }
}

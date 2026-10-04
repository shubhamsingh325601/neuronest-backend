import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { CreateClinicianDto } from '@modules/clinicians/shared/create-clinician.dto';
import { CreateClinicianService } from './create-clinician.service';

@ApiTags('clinicians')
@Controller({ path: 'clinicians', version: '1' })
export class CreateClinicianController {
  constructor(private readonly createClinicianService: CreateClinicianService) {}

  @Post()
  @Auth('clinician:manage')
  @ApiCreatedResponse({ type: ClinicianDetailDto })
  @ApiOperation({
    operationId: 'clinicianCreate',
    summary: 'Admin: create an INVITED clinician and email them a setup link.',
  })
  create(@Body() dto: CreateClinicianDto): Promise<ClinicianDetailDto> {
    return this.createClinicianService.create(dto);
  }
}

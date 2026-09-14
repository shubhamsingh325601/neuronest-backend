import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { CreateApplicationDto, CreateApplicationResponseDto } from './dto/create-application.dto';
import { SubmitApplicationService } from './submit-application.service';

@ApiTags('clinicians')
@Controller({ path: 'clinician-applications', version: '1' })
export class SubmitApplicationController {
  constructor(private readonly submitApplicationService: SubmitApplicationService) {}

  @Post()
  @Public()
  @ApiCreatedResponse({ type: CreateApplicationResponseDto })
  @ApiOperation({
    operationId: 'clinicianApplicationSubmit',
    summary: 'Public clinician application form — creates a lead for admin review.',
  })
  submit(@Body() dto: CreateApplicationDto): Promise<CreateApplicationResponseDto> {
    return this.submitApplicationService.submit(dto);
  }
}

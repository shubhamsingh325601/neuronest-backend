import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ApproveApplicationResponseDto } from './dto/approve-application.response.dto';
import { ApproveApplicationService } from './approve-application.service';

@ApiTags('clinicians')
@Controller({ path: 'clinician-applications', version: '1' })
export class ApproveApplicationController {
  constructor(private readonly approveApplicationService: ApproveApplicationService) {}

  @Post(':id/approve')
  @Auth('clinician-application:review')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ApproveApplicationResponseDto })
  @ApiOperation({
    operationId: 'clinicianApplicationApprove',
    summary: 'Admin: approve an application — provisions an INVITED clinician and emails a setup link.',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApproveApplicationResponseDto> {
    return this.approveApplicationService.approve(id);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import {
  RejectApplicationDto,
  RejectApplicationResponseDto,
} from './dto/reject-application.dto';
import { RejectApplicationService } from './reject-application.service';

@ApiTags('clinicians')
@Controller({ path: 'clinician-applications', version: '1' })
export class RejectApplicationController {
  constructor(private readonly rejectApplicationService: RejectApplicationService) {}

  @Post(':id/reject')
  @Auth('clinician-application:review')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RejectApplicationResponseDto })
  @ApiOperation({
    operationId: 'clinicianApplicationReject',
    summary: 'Admin: reject an application, optionally recording a reason.',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ): Promise<RejectApplicationResponseDto> {
    return this.rejectApplicationService.reject(id, dto);
  }
}

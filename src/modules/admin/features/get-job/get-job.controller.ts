import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { JobDto } from '@modules/admin/shared/job.dto';
import { GetJobService } from './get-job.service';

@ApiTags('admin')
@Controller({ path: 'admin/jobs', version: '1' })
export class GetJobController {
  constructor(private readonly getJobService: GetJobService) {}

  @Get(':id')
  @Auth('job:read')
  @ApiOkResponse({ type: JobDto })
  @ApiOperation({ operationId: 'jobGet', summary: 'Admin: read a single background job.' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<JobDto> {
    return this.getJobService.getById(id);
  }
}

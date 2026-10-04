import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { JobDto } from '@modules/admin/shared/job.dto';
import { RequeueJobService } from './requeue-job.service';

@ApiTags('admin')
@Controller({ path: 'admin/jobs', version: '1' })
export class RequeueJobController {
  constructor(private readonly requeueJobService: RequeueJobService) {}

  @Post(':id/requeue')
  @Auth('job:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: JobDto })
  @ApiOperation({
    operationId: 'jobRequeue',
    summary: 'Admin: put a DEAD job back on the queue (attempts reset, runs now).',
  })
  requeue(@Param('id', ParseUUIDPipe) id: string): Promise<JobDto> {
    return this.requeueJobService.requeue(id);
  }
}

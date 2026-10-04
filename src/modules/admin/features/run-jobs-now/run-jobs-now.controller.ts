import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { JobRunnerService } from '@common/jobs/job-runner.service';
import { RunDueResponseDto } from '@modules/jobs/features/run-due/dto/run-due.response.dto';

/**
 * Admin "Run pending jobs now" button — the primary manual driver on hosts that sleep
 * (plan 0011 §3 row 11a). Authenticated, so no shared secret and no `@Public()` exception.
 */
@ApiTags('admin')
@Controller({ path: 'admin/jobs/run-due', version: '1' })
export class RunJobsNowController {
  constructor(private readonly runner: JobRunnerService) {}

  @Post()
  @Auth('job:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RunDueResponseDto })
  @ApiOperation({
    operationId: 'jobRunDueAdmin',
    summary: 'Admin: run every due background job now and return the outcome counts.',
  })
  runNow(): Promise<RunDueResponseDto> {
    return this.runner.runDue();
  }
}

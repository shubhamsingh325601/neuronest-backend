import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/authz/auth.decorator';
import { JobRunnerService } from '@common/jobs/job-runner.service';
import { RunDueResponseDto } from './dto/run-due.response.dto';
import { JobsTokenGuard } from './jobs-token.guard';

/** Optional machine trigger for an external cron/pinger. Disabled (404) unless JOBS_RUN_TOKEN is set. */
@ApiTags('jobs')
@Controller({ path: 'jobs/run-due', version: '1' })
export class RunDueController {
  constructor(private readonly runner: JobRunnerService) {}

  @Post()
  @Public()
  @UseGuards(JobsTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'X-Jobs-Token',
    required: true,
    description: 'Shared secret (JOBS_RUN_TOKEN).',
  })
  @ApiOkResponse({ type: RunDueResponseDto })
  @ApiOperation({
    operationId: 'jobRunDue',
    summary: 'Machine trigger: run every due background job now (token-guarded; off by default).',
  })
  runDue(): Promise<RunDueResponseDto> {
    return this.runner.runDue();
  }
}

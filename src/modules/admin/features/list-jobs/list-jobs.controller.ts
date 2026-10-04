import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ListJobsQueryDto, ListJobsResponseDto } from './dto/list-jobs.dto';
import { ListJobsService } from './list-jobs.service';

@ApiTags('admin')
@Controller({ path: 'admin/jobs', version: '1' })
export class ListJobsController {
  constructor(private readonly listJobsService: ListJobsService) {}

  @Get()
  @Auth('job:read')
  @ApiOkResponse({ type: ListJobsResponseDto })
  @ApiOperation({
    operationId: 'jobList',
    summary:
      'Admin: cursor-paginated background jobs, filter by ?status=&type= (DEAD = error list).',
  })
  list(@Query() query: ListJobsQueryDto): Promise<ListJobsResponseDto> {
    return this.listJobsService.list(query);
  }
}

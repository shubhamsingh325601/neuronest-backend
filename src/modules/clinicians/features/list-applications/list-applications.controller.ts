import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ListApplicationsQueryDto } from './dto/list-applications.query.dto';
import { ListApplicationsResponseDto } from './dto/list-applications.response.dto';
import { ListApplicationsService } from './list-applications.service';

@ApiTags('clinicians')
@Controller({ path: 'clinician-applications', version: '1' })
export class ListApplicationsController {
  constructor(private readonly listApplicationsService: ListApplicationsService) {}

  @Get()
  @Auth('clinician-application:list')
  @ApiOkResponse({ type: ListApplicationsResponseDto })
  @ApiOperation({
    operationId: 'clinicianApplicationList',
    summary: 'Admin: cursor-paginated clinician application queue, filterable by status.',
  })
  list(@Query() query: ListApplicationsQueryDto): Promise<ListApplicationsResponseDto> {
    return this.listApplicationsService.list(query);
  }
}

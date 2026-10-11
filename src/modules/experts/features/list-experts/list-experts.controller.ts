import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ListExpertsQueryDto } from './dto/list-experts.query.dto';
import { ListExpertsResponseDto } from './dto/list-experts.response.dto';
import { ListExpertsService } from './list-experts.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class ListExpertsController {
  constructor(private readonly listExpertsService: ListExpertsService) {}

  @Get()
  @Auth('expert:list')
  @ApiOkResponse({ type: ListExpertsResponseDto })
  @ApiOperation({
    operationId: 'expertList',
    summary: 'Admin: cursor-paginated directory of EXPERT users.',
  })
  list(@Query() query: ListExpertsQueryDto): Promise<ListExpertsResponseDto> {
    return this.listExpertsService.list(query);
  }
}

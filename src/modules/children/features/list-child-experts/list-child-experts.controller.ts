import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';
import { ListChildExpertsService } from './list-child-experts.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class ListChildExpertsController {
  constructor(private readonly listChildExpertsService: ListChildExpertsService) {}

  @Get(':childId/experts')
  @Auth('expert-child:manage')
  @ApiOkResponse({ type: [ExpertChildAssignmentDto] })
  @ApiOperation({
    operationId: 'childExpertsList',
    summary: 'Admin: the experts assigned to a child. No pagination.',
  })
  list(@Param('childId', ParseUUIDPipe) childId: string): Promise<ExpertChildAssignmentDto[]> {
    return this.listChildExpertsService.list(childId);
  }
}

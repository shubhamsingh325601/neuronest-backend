import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';
import { ListExpertChildrenService } from './list-expert-children.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class ListExpertChildrenController {
  constructor(private readonly listExpertChildrenService: ListExpertChildrenService) {}

  @Get(':id/children')
  @Auth('expert-child:manage')
  @ApiOkResponse({ type: [ExpertChildAssignmentDto] })
  @ApiOperation({
    operationId: 'expertChildrenList',
    summary: 'Admin: the children assigned to an expert. No pagination.',
  })
  list(@Param('id', ParseUUIDPipe) id: string): Promise<ExpertChildAssignmentDto[]> {
    return this.listExpertChildrenService.list(id);
  }
}

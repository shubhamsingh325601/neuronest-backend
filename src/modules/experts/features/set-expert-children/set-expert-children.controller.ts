import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';
import { SetExpertChildrenDto } from './dto/set-expert-children.dto';
import { SetExpertChildrenService } from './set-expert-children.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class SetExpertChildrenController {
  constructor(private readonly setExpertChildrenService: SetExpertChildrenService) {}

  @Put(':id/children')
  @Auth('expert-child:manage')
  @ApiOkResponse({ type: [ExpertChildAssignmentDto] })
  @ApiOperation({
    operationId: 'expertChildrenSet',
    summary: "Admin: replace an expert's whole set of assigned children in one call.",
  })
  set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExpertChildrenDto,
  ): Promise<ExpertChildAssignmentDto[]> {
    return this.setExpertChildrenService.set(id, dto);
  }
}

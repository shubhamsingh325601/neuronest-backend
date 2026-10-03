import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ClinicianChildAssignmentDto } from '@modules/children/shared/clinician-child-assignment.dto';
import { ListClinicianAssignmentsService } from './list-clinician-assignments.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class ListClinicianAssignmentsController {
  constructor(private readonly listClinicianAssignmentsService: ListClinicianAssignmentsService) {}

  @Get(':id/clinicians')
  @Auth('child:read')
  @ApiOkResponse({ type: [ClinicianChildAssignmentDto] })
  @ApiOperation({
    operationId: 'childClinicianList',
    summary: "A child's care team — every clinician currently assigned. No pagination.",
  })
  list(
    @Param('id', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ClinicianChildAssignmentDto[]> {
    return this.listClinicianAssignmentsService.list(childId, caller);
  }
}

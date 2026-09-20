import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { ClinicianChildAssignmentDto } from '@modules/children/shared/clinician-child-assignment.dto';
import { AssignClinicianDto } from './dto/assign-clinician.dto';
import { AssignClinicianService } from './assign-clinician.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class AssignClinicianController {
  constructor(private readonly assignClinicianService: AssignClinicianService) {}

  @Post(':id/clinicians')
  @Auth('clinician-child:manage')
  @ApiCreatedResponse({ type: ClinicianChildAssignmentDto })
  @ApiOperation({
    operationId: 'childAssignClinician',
    summary: 'Admin: assign a clinician to a child.',
  })
  assign(
    @Param('id', ParseUUIDPipe) childId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: AssignClinicianDto,
  ): Promise<ClinicianChildAssignmentDto> {
    return this.assignClinicianService.assign(childId, adminId, dto);
  }
}

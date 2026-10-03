import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { RevokeClinicianAssignmentService } from './revoke-clinician-assignment.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class RevokeClinicianAssignmentController {
  constructor(private readonly revokeClinicianAssignmentService: RevokeClinicianAssignmentService) {}

  @Delete(':id/clinicians/:clinicianId')
  @Auth('clinician-child:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiOperation({
    operationId: 'childClinicianRevoke',
    summary: "Admin: revoke a clinician's assignment to a child. Idempotent.",
  })
  revoke(
    @Param('id', ParseUUIDPipe) childId: string,
    @Param('clinicianId', ParseUUIDPipe) clinicianId: string,
  ): Promise<void> {
    return this.revokeClinicianAssignmentService.revoke(childId, clinicianId);
  }
}

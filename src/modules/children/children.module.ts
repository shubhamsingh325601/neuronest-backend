import { Module } from '@nestjs/common';
import { CreateChildController } from './features/create-child/create-child.controller';
import { CreateChildService } from './features/create-child/create-child.service';
import { GetChildController } from './features/get-child/get-child.controller';
import { GetChildService } from './features/get-child/get-child.service';
import { ListChildrenController } from './features/list-children/list-children.controller';
import { ListChildrenService } from './features/list-children/list-children.service';
import { AssignClinicianController } from './features/assign-clinician/assign-clinician.controller';
import { AssignClinicianService } from './features/assign-clinician/assign-clinician.service';
import { ListClinicianAssignmentsController } from './features/list-clinician-assignments/list-clinician-assignments.controller';
import { ListClinicianAssignmentsService } from './features/list-clinician-assignments/list-clinician-assignments.service';
import { RevokeClinicianAssignmentController } from './features/revoke-clinician-assignment/revoke-clinician-assignment.controller';
import { RevokeClinicianAssignmentService } from './features/revoke-clinician-assignment/revoke-clinician-assignment.service';
import { UpdateChildController } from './features/update-child/update-child.controller';
import { UpdateChildService } from './features/update-child/update-child.service';
import { SetClinicalProfileController } from './features/set-clinical-profile/set-clinical-profile.controller';
import { SetClinicalProfileService } from './features/set-clinical-profile/set-clinical-profile.service';

/**
 * Core Care Domain foundation (Phase 4): the `Child` record and the
 * clinicianâ†”child assignment join. Later phases (media, plans, call logs) build on
 * top of this module's `Child` model without touching it.
 */
@Module({
  controllers: [
    CreateChildController,
    GetChildController,
    ListChildrenController,
    AssignClinicianController,
    ListClinicianAssignmentsController,
    RevokeClinicianAssignmentController,
    UpdateChildController,
    SetClinicalProfileController,
  ],
  providers: [
    CreateChildService,
    GetChildService,
    ListChildrenService,
    AssignClinicianService,
    ListClinicianAssignmentsService,
    RevokeClinicianAssignmentService,
    UpdateChildService,
    SetClinicalProfileService,
  ],
  // Exported for the AI coaching module, which authorises through the same ownership rules.
  exports: [GetChildService],
})
export class ChildrenModule {}

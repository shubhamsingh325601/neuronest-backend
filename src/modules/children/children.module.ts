import { Module } from '@nestjs/common';
import { CreateChildController } from './features/create-child/create-child.controller';
import { CreateChildService } from './features/create-child/create-child.service';
import { GetChildController } from './features/get-child/get-child.controller';
import { GetChildService } from './features/get-child/get-child.service';
import { AssignClinicianController } from './features/assign-clinician/assign-clinician.controller';
import { AssignClinicianService } from './features/assign-clinician/assign-clinician.service';

/**
 * Core Care Domain foundation (Phase 4): the `Child` record and the
 * clinician↔child assignment join. Later phases (media, plans, call logs) build on
 * top of this module's `Child` model without touching it.
 */
@Module({
  controllers: [CreateChildController, GetChildController, AssignClinicianController],
  providers: [CreateChildService, GetChildService, AssignClinicianService],
})
export class ChildrenModule {}

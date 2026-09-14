import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { SubmitApplicationController } from './features/submit-application/submit-application.controller';
import { SubmitApplicationService } from './features/submit-application/submit-application.service';
import { ListApplicationsController } from './features/list-applications/list-applications.controller';
import { ListApplicationsService } from './features/list-applications/list-applications.service';
import { GetApplicationController } from './features/get-application/get-application.controller';
import { GetApplicationService } from './features/get-application/get-application.service';
import { ApproveApplicationController } from './features/approve-application/approve-application.controller';
import { ApproveApplicationService } from './features/approve-application/approve-application.service';
import { RejectApplicationController } from './features/reject-application/reject-application.controller';
import { RejectApplicationService } from './features/reject-application/reject-application.service';

/**
 * Clinician domain. Public application submission (Phase 1) plus the admin review
 * queue — list / view / approve / reject (Phase 3). Later phases add clinician-facing
 * functionality gated by the subscription model (insights, reports, caseload).
 */
@Module({
  imports: [AuthModule], // for VerificationTokenService (ACCOUNT_SETUP tokens on approve)
  controllers: [
    SubmitApplicationController,
    ListApplicationsController,
    GetApplicationController,
    ApproveApplicationController,
    RejectApplicationController,
  ],
  providers: [
    SubmitApplicationService,
    ListApplicationsService,
    GetApplicationService,
    ApproveApplicationService,
    RejectApplicationService,
  ],
})
export class CliniciansModule {}

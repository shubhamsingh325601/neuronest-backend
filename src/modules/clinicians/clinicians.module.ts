import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { ListCliniciansController } from './features/list-clinicians/list-clinicians.controller';
import { ListCliniciansService } from './features/list-clinicians/list-clinicians.service';
import { CreateClinicianController } from './features/create-clinician/create-clinician.controller';
import { CreateClinicianService } from './features/create-clinician/create-clinician.service';
import { GetClinicianController } from './features/get-clinician/get-clinician.controller';
import { GetClinicianService } from './features/get-clinician/get-clinician.service';
import { UpdateClinicianController } from './features/update-clinician/update-clinician.controller';
import { UpdateClinicianService } from './features/update-clinician/update-clinician.service';
import { ResendInvitationController } from './features/resend-invitation/resend-invitation.controller';
import { ResendInvitationService } from './features/resend-invitation/resend-invitation.service';
import { InvitationService } from './shared/invitation.service';

/**
 * Clinician domain. Clinicians are created by an admin (Phase 10): create / list / get /
 * update / resend-invitation. The public application flow of Phases 1 and 3 was removed.
 * Activate/deactivate reuses the generic `/users/{id}/suspend|reactivate` routes. Later
 * phases add clinician-facing functionality (insights, reports, caseload).
 */
@Module({
  imports: [AuthModule], // for VerificationTokenService (ACCOUNT_SETUP tokens on invite)
  controllers: [
    ListCliniciansController,
    CreateClinicianController,
    GetClinicianController,
    UpdateClinicianController,
    ResendInvitationController,
  ],
  providers: [
    ListCliniciansService,
    InvitationService,
    CreateClinicianService,
    GetClinicianService,
    UpdateClinicianService,
    ResendInvitationService,
  ],
})
export class CliniciansModule {}

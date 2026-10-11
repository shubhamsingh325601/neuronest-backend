import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { CreateExpertController } from './features/create-expert/create-expert.controller';
import { CreateExpertService } from './features/create-expert/create-expert.service';
import { GetExpertController } from './features/get-expert/get-expert.controller';
import { GetExpertService } from './features/get-expert/get-expert.service';
import { ListExpertChildrenController } from './features/list-expert-children/list-expert-children.controller';
import { ListExpertChildrenService } from './features/list-expert-children/list-expert-children.service';
import { ListExpertsController } from './features/list-experts/list-experts.controller';
import { ListExpertsService } from './features/list-experts/list-experts.service';
import { ResetExpertPasswordController } from './features/reset-expert-password/reset-expert-password.controller';
import { ResetExpertPasswordService } from './features/reset-expert-password/reset-expert-password.service';
import { SetExpertChildrenController } from './features/set-expert-children/set-expert-children.controller';
import { SetExpertChildrenService } from './features/set-expert-children/set-expert-children.service';
import { UpdateExpertController } from './features/update-expert/update-expert.controller';
import { UpdateExpertService } from './features/update-expert/update-expert.service';

/**
 * Expert domain (plan 0019). Experts are created directly by an admin with a password (no
 * invitation) and sign in through the normal login. An expert has read-only access to the
 * children an admin assigns them. Suspend/reactivate reuses `/users/{id}/suspend|reactivate`.
 */
@Module({
  imports: [AuthModule], // RefreshTokenService (sign the expert out on password reset)
  controllers: [
    ListExpertsController,
    CreateExpertController,
    GetExpertController,
    UpdateExpertController,
    ResetExpertPasswordController,
    SetExpertChildrenController,
    ListExpertChildrenController,
  ],
  providers: [
    ListExpertsService,
    CreateExpertService,
    GetExpertService,
    UpdateExpertService,
    ResetExpertPasswordService,
    SetExpertChildrenService,
    ListExpertChildrenService,
  ],
})
export class ExpertsModule {}

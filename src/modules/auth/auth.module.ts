import { Module } from '@nestjs/common';
import { RefreshTokenService } from './shared/refresh-token.service';
import { VerificationTokenService } from './shared/verification-token.service';
import { SignupController } from './features/signup/signup.controller';
import { SignupService } from './features/signup/signup.service';
import { VerifyEmailController } from './features/verify-email/verify-email.controller';
import { VerifyEmailService } from './features/verify-email/verify-email.service';
import { LoginController } from './features/login/login.controller';
import { LoginService } from './features/login/login.service';
import { RefreshTokenController } from './features/refresh-token/refresh-token.controller';
import { RefreshTokenFeatureService } from './features/refresh-token/refresh-token.service';
import { LogoutController } from './features/logout/logout.controller';
import { LogoutService } from './features/logout/logout.service';
import { ForgotPasswordController } from './features/forgot-password/forgot-password.controller';
import { ForgotPasswordService } from './features/forgot-password/forgot-password.service';
import { ResetPasswordController } from './features/reset-password/reset-password.controller';
import { ResetPasswordService } from './features/reset-password/reset-password.service';
import { CompleteAccountSetupController } from './features/complete-account-setup/complete-account-setup.controller';
import { CompleteAccountSetupService } from './features/complete-account-setup/complete-account-setup.service';

@Module({
  controllers: [
    SignupController,
    VerifyEmailController,
    LoginController,
    RefreshTokenController,
    LogoutController,
    ForgotPasswordController,
    ResetPasswordController,
    CompleteAccountSetupController,
  ],
  providers: [
    // shared within the auth module
    RefreshTokenService,
    VerificationTokenService,
    // per-feature
    SignupService,
    VerifyEmailService,
    LoginService,
    RefreshTokenFeatureService,
    LogoutService,
    ForgotPasswordService,
    ResetPasswordService,
    CompleteAccountSetupService,
  ],
  exports: [RefreshTokenService, VerificationTokenService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { GetConsentController } from './features/get-consent/get-consent.controller';
import { GetConsentService } from './features/get-consent/get-consent.service';
import { GrantConsentController } from './features/grant-consent/grant-consent.controller';
import { GrantConsentService } from './features/grant-consent/grant-consent.service';
import { WithdrawConsentController } from './features/withdraw-consent/withdraw-consent.controller';
import { WithdrawConsentService } from './features/withdraw-consent/withdraw-consent.service';

/** Parent media-consent record (Phase 12): foundation only — no gating, retention or wording. */
@Module({
  controllers: [GetConsentController, GrantConsentController, WithdrawConsentController],
  providers: [GetConsentService, GrantConsentService, WithdrawConsentService],
})
export class ConsentsModule {}

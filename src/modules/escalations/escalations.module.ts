import { Module } from '@nestjs/common';
import { CreateEscalationController } from './features/create-escalation/create-escalation.controller';
import { CreateEscalationService } from './features/create-escalation/create-escalation.service';
import { GetActiveEscalationController } from './features/get-active-escalation/get-active-escalation.controller';
import { GetActiveEscalationService } from './features/get-active-escalation/get-active-escalation.service';
import { ListChildEscalationsController } from './features/list-child-escalations/list-child-escalations.controller';
import { ListChildEscalationsService } from './features/list-child-escalations/list-child-escalations.service';
import { CancelEscalationController } from './features/cancel-escalation/cancel-escalation.controller';
import { CancelEscalationService } from './features/cancel-escalation/cancel-escalation.service';
import { HandleEscalationController } from './features/handle-escalation/handle-escalation.controller';
import { HandleEscalationService } from './features/handle-escalation/handle-escalation.service';
import { ListEscalationsController } from './features/list-escalations/list-escalations.controller';
import { ListEscalationsService } from './features/list-escalations/list-escalations.service';

/**
 * Parent-raised urgent-support requests (plan 0017 batch F). Clinicians review: acknowledge, resolve with
 * a note, watch the queue and the 24 h deadline. No messaging.
 */
@Module({
  controllers: [
    CreateEscalationController,
    GetActiveEscalationController,
    ListChildEscalationsController,
    CancelEscalationController,
    HandleEscalationController,
    ListEscalationsController,
  ],
  providers: [
    CreateEscalationService,
    GetActiveEscalationService,
    ListChildEscalationsService,
    CancelEscalationService,
    HandleEscalationService,
    ListEscalationsService,
  ],
})
export class EscalationsModule {}

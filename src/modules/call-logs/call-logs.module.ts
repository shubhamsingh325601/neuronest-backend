import { Module } from '@nestjs/common';
import { LogCallController } from './features/log-call/log-call.controller';
import { LogCallService } from './features/log-call/log-call.service';
import { ListCallHistoryController } from './features/list-call-history/list-call-history.controller';
import { ListCallHistoryService } from './features/list-call-history/list-call-history.service';

/**
 * Monthly call log (Phase 7): records that a clinician made their monthly check-in
 * call with a child's parent. Depends on `children`'s `Child`/
 * `ClinicianChildAssignment` tables directly via Prisma — no cross-module service
 * import, consistent with "no repository layer." A new domain module rather than
 * folded into `children`, matching the "one module per domain" convention.
 */
@Module({
  controllers: [LogCallController, ListCallHistoryController],
  providers: [LogCallService, ListCallHistoryService],
})
export class CallLogsModule {}

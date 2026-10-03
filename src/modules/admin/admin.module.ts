import { Module } from '@nestjs/common';
import { GetSummaryController } from './features/get-summary/get-summary.controller';
import { GetSummaryService } from './features/get-summary/get-summary.service';

/**
 * Admin domain (Phase 8, D1). Owns no domain's writes, only reads across domains via
 * `PrismaService` directly — same "no repository layer, Prisma is the data-access
 * layer" convention as every other feature module.
 */
@Module({
  controllers: [GetSummaryController],
  providers: [GetSummaryService],
})
export class AdminModule {}

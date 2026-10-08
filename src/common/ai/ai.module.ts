import { Global, Module } from '@nestjs/common';
import { AiBudgetService } from './ai-budget.service';
import { AiModelFactory } from './ai-model.factory';
import { AiRunRecorder } from './ai-run.recorder';
import { AiService } from './ai.service';
import { VercelAiService } from './vercel-ai.service';

@Global()
@Module({
  providers: [
    AiModelFactory,
    AiRunRecorder,
    AiBudgetService,
    { provide: AiService, useClass: VercelAiService },
  ],
  exports: [AiService, AiBudgetService],
})
export class AiModule {}
